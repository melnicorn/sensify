import Link from 'next/link'
import { Thermometer, Droplets, Gauge, Clock, MapPin, Download, Upload, Radio, AlertTriangle, PauseCircle, Bell, BellOff, CheckCircle2 } from 'lucide-react'
import type { SensorMeta, LatestMetric, AppConfig } from '@/lib/types'
import type { SensorAlertSummary } from '@/lib/alerts/repo'
import { formatTemperature, formatHumidity, formatMetricValue, metricLabel } from '@/lib/units'

interface Props {
  meta: SensorMeta
  latest: LatestMetric[]
  config: AppConfig
  /** Absent when the sensor has no alert rules — the card then shows nothing. */
  alert?: SensorAlertSummary
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function MetricValue({ meta, m, config }: { meta: SensorMeta; m: LatestMetric; config: AppConfig }) {
  const field = (meta.pull ?? meta.mqtt)?.fields.find((f) => f.metric === m.metric)
  // Temperatures are stored canonically in °C — push sensors always, pull
  // fields when their unit label was recognized as a temperature
  const isTemp =
    (meta.type === 'push' && m.metric === 'temperature') || field?.unitKind === 'temperature'
  if (isTemp) {
    return (
      <div className="flex items-center gap-1.5" title={metricLabel(m.metric)}>
        <Thermometer size={16} className="text-primary" />
        <span className="text-lg font-medium tabular-nums">
          {formatTemperature(m.value, 'C', config.temperatureUnit)}
        </span>
      </div>
    )
  }
  if (meta.type === 'push' && m.metric === 'humidity') {
    return (
      <div className="flex items-center gap-1.5">
        <Droplets size={16} className="text-primary" />
        <span className="text-lg font-medium tabular-nums">{formatHumidity(m.value)}</span>
      </div>
    )
  }
  const unit = field?.unit
  return (
    <div className="flex items-center gap-1.5" title={metricLabel(m.metric)}>
      <Gauge size={16} className="text-primary" />
      <div className="flex flex-col leading-tight">
        <span className="text-lg font-medium tabular-nums">{formatMetricValue(m.value, unit)}</span>
        <span className="text-[10px] text-muted-foreground">{metricLabel(m.metric)}</span>
      </div>
    </div>
  )
}

/** Compact alert state. Renders nothing when the sensor has no rules. */
function AlertLine({ alert }: { alert: SensorAlertSummary }) {
  const extra = alert.ruleCount > 1 ? ` +${alert.ruleCount - 1}` : ''
  const base = 'flex items-center gap-1 text-xs mb-2 truncate'

  switch (alert.status) {
    case 'active':
      return (
        <p className={`${base} text-primary`}>
          <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-current" />
          <span className="truncate">
            {alert.ruleName}
            {alert.since && ` · ${timeAgo(alert.since).replace(' ago', '')}`}
            {extra}
          </span>
        </p>
      )
    case 'error':
      return (
        <p className={`${base} text-amber-600 dark:text-amber-400`}>
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate">
            {alert.ruleName} — alert error{extra}
          </span>
        </p>
      )
    case 'completed':
      return (
        <p className={`${base} text-green-600 dark:text-green-400`}>
          <CheckCircle2 size={12} className="shrink-0" />
          <span className="truncate">
            {alert.ruleName} finished {alert.since && timeAgo(alert.since)}
            {extra}
          </span>
        </p>
      )
    case 'paused':
      return (
        <p className={`${base} text-muted-foreground`}>
          <BellOff size={12} className="shrink-0" />
          <span className="truncate">
            {alert.ruleName} paused{extra}
          </span>
        </p>
      )
    default:
      // Idle: deliberately the quietest state, so a dashboard of calm sensors
      // stays calm — just a count, no rule name.
      return (
        <p className={`${base} text-muted-foreground/70`}>
          <Bell size={12} className="shrink-0" />
          {alert.ruleCount} alert{alert.ruleCount === 1 ? '' : 's'}
        </p>
      )
  }
}

export function SensorCard({ meta, latest, config, alert }: Props) {
  const locationParts = [meta.location, meta.zone].filter(Boolean)
  const latestTs = latest.reduce<string | null>((max, m) => (max && max > m.ts ? max : m.ts), null)
  // pull and mqtt share the same enabled/error bookkeeping
  const src = meta.pull ?? meta.mqtt
  const srcPaused = src ? !src.enabled : false
  const srcError = src?.enabled && src.lastError ? src.lastError : null

  return (
    <Link
      href={`/sensors/${meta.id}`}
      className="block rounded-lg border border-border bg-card p-4 hover:border-primary transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 className="flex items-center gap-1.5 font-semibold text-foreground min-w-0">
          {meta.type === 'pull' ? (
            <Download size={13} className="text-muted-foreground shrink-0" aria-label="Pull device" />
          ) : meta.type === 'mqtt' ? (
            <Radio size={13} className="text-muted-foreground shrink-0" aria-label="MQTT device" />
          ) : (
            <Upload size={13} className="text-muted-foreground shrink-0" aria-label="Push device" />
          )}
          <span className="truncate">{meta.name}</span>
        </h2>
        {latestTs && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock size={12} />
            {timeAgo(latestTs)}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground font-mono mb-2 truncate">{meta.id}</p>

      {locationParts.length > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <MapPin size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">{locationParts.join(' · ')}</span>
          {meta.floor != null && (
            <span className="text-xs text-muted-foreground">· Floor {meta.floor}</span>
          )}
        </div>
      )}

      {alert && <AlertLine alert={alert} />}

      {meta.mqtt?.online === false && (
        <p className="flex items-center gap-1 text-xs text-destructive mb-2">
          <AlertTriangle size={12} className="shrink-0" />
          Device offline
        </p>
      )}
      {srcPaused && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          <PauseCircle size={12} />
          {meta.type === 'mqtt' ? 'Ingest paused' : 'Polling paused'}
        </p>
      )}
      {srcError && (
        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mb-2 truncate">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate">{srcError}</span>
        </p>
      )}

      {latest.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {latest.map((m) => (
            <MetricValue key={m.metric} meta={meta} m={m} config={config} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No readings yet</p>
      )}
    </Link>
  )
}
