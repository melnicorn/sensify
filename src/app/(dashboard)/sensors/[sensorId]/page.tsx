import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Wifi, Download, Upload, Radio, ChevronRight } from 'lucide-react'
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
import { MqttStatusPanel } from '@/components/mqtt-status-panel'
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
              ) : meta.type === 'mqtt' ? (
                <Radio size={15} className="text-muted-foreground" aria-label="MQTT device" />
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
          <div className="flex shrink-0 items-center gap-2">
            {meta.type !== 'mqtt' && (
              <Link
                href={`/devices/${meta.id}/mqtt`}
                className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                title="Move this sensor onto MQTT, keeping its history"
              >
                <Radio size={13} />
                Switch to MQTT
              </Link>
            )}
            <DeleteSensorButton sensorId={meta.id} sensorName={meta.name} />
          </div>
        </div>
      </div>

      {/* Last read values, refreshed at the device's cadence */}
      <LatestReadings meta={meta} config={config} initial={latest} />

      {/* Metadata + device config side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SensorMetaPanel meta={meta} editAction={metaAction} />
        {meta.type === 'pull' ? (
          <PullStatusPanel meta={meta} />
        ) : meta.type === 'mqtt' ? (
          <MqttStatusPanel meta={meta} />
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

      <SensorChartLive
        meta={meta}
        initialRange={range}
        initialReadings={readings}
        config={config}
        channels={channels}
      />

      {/* Alert event history — below the chart and collapsed by default, since
          the chart is what the page is for and this table can get long. Native
          <details> keeps this a server component. */}
      {(ruleViews.length > 0 || events.length > 0) && (
        <details className="rounded-lg border border-border bg-card p-4 group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-foreground marker:hidden">
            <ChevronRight
              size={14}
              className="text-muted-foreground transition-transform group-open:rotate-90"
            />
            Alert history
            {events.length > 0 && (
              <span className="font-normal text-muted-foreground">({events.length})</span>
            )}
          </summary>
          <div className="mt-3">
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
        </details>
      )}
    </div>
  )
}
