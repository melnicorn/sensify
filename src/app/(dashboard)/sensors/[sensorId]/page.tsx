import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Wifi, Download, Upload } from 'lucide-react'
import { getSensorMeta, getReadings, getLatestMetrics, getConfig } from '@/lib/storage'
import { listChannels, listRulesForSensor, listEventsForSensor } from '@/lib/alerts/repo'
import { buildRuleViews } from '@/lib/alerts/views'
import { SensorAlertsCard } from '@/components/sensor-alerts-card'
import { LatestReadings } from '@/components/latest-readings'
import { SensorChartLive } from '@/components/sensor-chart-live'
import { DeleteSensorButton } from '@/components/delete-sensor-button'
import { SensorMetaPanel } from '@/components/sensor-meta-panel'
import { SensorIntervalForm } from '@/components/sensor-interval-form'
import { PullStatusPanel } from '@/components/pull-status-panel'
import { updateSensorMetaAction, updateDesiredIntervalAction } from '@/app/actions'
import { convertTemperature, formatMetricValue, metricDisplayInfo } from '@/lib/units'
import { RANGES, DEFAULT_RANGE, rangeHours } from '@/lib/chart-ranges'
import type { SensorMeta, AppConfig } from '@/lib/types'

function fmtEventDuration(fromIso: string, toIso: string): string {
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function fmtEventValue(
  meta: SensorMeta,
  config: AppConfig,
  metric: string | null,
  value: number
): string {
  if (!metric) return formatMetricValue(value)
  const { isTemp, unit } = metricDisplayInfo(meta, config, metric)
  const display = isTemp ? convertTemperature(value, 'C', config.temperatureUnit) : value
  return formatMetricValue(parseFloat(display.toFixed(1)), unit)
}

export default async function SensorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sensorId: string }>
  searchParams: Promise<{ range?: string }>
}) {
  const { sensorId } = await params
  const { range: rawRange } = await searchParams
  const range = rawRange && rawRange in RANGES ? rawRange : DEFAULT_RANGE

  const [meta, config, channels, sensorRules, latest, events] = await Promise.all([
    getSensorMeta(sensorId),
    getConfig(),
    listChannels(),
    listRulesForSensor(sensorId),
    getLatestMetrics(sensorId),
    listEventsForSensor(sensorId, 20),
  ])
  if (!meta) notFound()
  const ruleViews = await buildRuleViews(sensorRules)

  const now = new Date()
  const from = new Date(now.getTime() - rangeHours(range) * 3_600_000)
  const readings = await getReadings(sensorId, from.toISOString(), now.toISOString())

  // Bind server actions to this sensor
  const metaAction = updateSensorMetaAction.bind(null, meta.id)
  const intervalAction = updateDesiredIntervalAction.bind(null, meta.id)

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Sensors
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-foreground font-medium">{meta.name}</span>
      </div>

      {/* Identity card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              {meta.type === 'pull' ? (
                <Download size={15} className="text-muted-foreground" aria-label="Pull device" />
              ) : (
                <Upload size={15} className="text-muted-foreground" aria-label="Push device" />
              )}
              {meta.name}
            </h1>
            <p className="text-xs text-muted-foreground font-mono">{meta.id}</p>
            <p className="text-xs text-muted-foreground">
              First seen: {new Date(meta.firstSeen).toLocaleString()} · Last seen:{' '}
              {new Date(meta.lastSeen).toLocaleString()}
            </p>
            {meta.lastIp && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Wifi size={11} />
                {meta.lastIp}
              </p>
            )}
          </div>
          <DeleteSensorButton sensorId={meta.id} sensorName={meta.name} />
        </div>
      </div>

      {/* Last read values, refreshed at the device's cadence */}
      <LatestReadings meta={meta} config={config} initial={latest} />

      {/* Metadata + device config side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SensorMetaPanel meta={meta} editAction={metaAction} />
        {meta.type === 'pull' ? (
          <PullStatusPanel meta={meta} />
        ) : (
          <SensorIntervalForm desiredInterval={meta.desiredInterval} setAction={intervalAction} />
        )}
      </div>

      {/* Alerts on this sensor */}
      <SensorAlertsCard
        meta={meta}
        config={config}
        channels={channels}
        ruleViews={ruleViews}
        editableRules={sensorRules
          .filter((r) => r.definition !== null)
          .map((r) => ({
            id: r.id,
            name: r.name,
            definition: r.definition!,
            channelIds: r.channelIds,
          }))}
      />

      {/* Alert event history for this sensor */}
      {(ruleViews.length > 0 || events.length > 0) && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">Alert history</h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alert events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="pb-2 pr-4 font-medium">Rule</th>
                    <th className="pb-2 pr-4 font-medium">Started</th>
                    <th className="pb-2 pr-4 font-medium">Duration</th>
                    <th className="pb-2 font-medium">Peak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((e) => (
                    <tr key={e.id} className="text-foreground">
                      <td className="py-2 pr-4">{e.ruleName}</td>
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap">
                        {new Date(e.startedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap">
                        {e.endedAt ? (
                          fmtEventDuration(e.startedAt, e.endedAt)
                        ) : (
                          <span className="text-green-600 dark:text-green-400">ongoing</span>
                        )}
                      </td>
                      <td className="py-2 tabular-nums whitespace-nowrap">
                        {e.stats ? fmtEventValue(meta, config, e.metric, e.stats.max) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <SensorChartLive
        meta={meta}
        initialRange={range}
        initialReadings={readings}
        config={config}
        channels={channels}
      />
    </div>
  )
}
