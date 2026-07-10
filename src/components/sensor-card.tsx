import Link from 'next/link'
import { Thermometer, Droplets, Gauge, Clock, MapPin, Download, Upload, AlertTriangle, PauseCircle } from 'lucide-react'
import type { SensorMeta, LatestMetric, AppConfig } from '@/lib/types'
import { formatTemperature, formatHumidity, formatMetricValue, metricLabel } from '@/lib/units'

interface Props {
  meta: SensorMeta
  latest: LatestMetric[]
  config: AppConfig
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
  // Push sensors store canonical metrics: temperature in °C, humidity in %
  if (meta.type === 'push' && m.metric === 'temperature') {
    return (
      <div className="flex items-center gap-1.5">
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
  const unit = meta.pull?.fields.find((f) => f.metric === m.metric)?.unit
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

export function SensorCard({ meta, latest, config }: Props) {
  const locationParts = [meta.location, meta.zone].filter(Boolean)
  const latestTs = latest.reduce<string | null>((max, m) => (max && max > m.ts ? max : m.ts), null)
  const pullPaused = meta.pull ? !meta.pull.enabled : false
  const pullError = meta.pull?.enabled && meta.pull.lastError ? meta.pull.lastError : null

  return (
    <Link
      href={`/sensors/${meta.id}`}
      className="block rounded-lg border border-border bg-card p-4 hover:border-primary transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 className="flex items-center gap-1.5 font-semibold text-foreground min-w-0">
          {meta.type === 'pull' ? (
            <Download size={13} className="text-muted-foreground shrink-0" aria-label="Pull device" />
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

      {pullPaused && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          <PauseCircle size={12} />
          Polling paused
        </p>
      )}
      {pullError && (
        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mb-2 truncate">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate">{pullError}</span>
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
