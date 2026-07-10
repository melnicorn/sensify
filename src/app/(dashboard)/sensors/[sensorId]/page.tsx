import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Wifi } from 'lucide-react'
import { getSensorMeta, getReadings, getConfig } from '@/lib/storage'
import { SensorChartLive } from '@/components/sensor-chart-live'
import { DeleteSensorButton } from '@/components/delete-sensor-button'
import { SensorMetaPanel } from '@/components/sensor-meta-panel'
import { SensorIntervalForm } from '@/components/sensor-interval-form'
import { updateSensorMetaAction, updateDesiredIntervalAction } from '@/app/actions'

const RANGES: Record<string, { label: string; days: number }> = {
  '1h': { label: '1 hour', days: 0 },
  '24h': { label: '24 hours', days: 1 },
  '7d': { label: '7 days', days: 7 },
  '30d': { label: '30 days', days: 30 },
}

function getRangeDates(range: string): { fromDate: string; toDate: string } {
  const now = new Date()
  const toDate = now.toISOString().substring(0, 10)
  if (range === '1h') return { fromDate: toDate, toDate }
  const days = RANGES[range]?.days ?? 7
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { fromDate: from.toISOString().substring(0, 10), toDate }
}

function filterByHours(readings: Awaited<ReturnType<typeof getReadings>>, hours: number) {
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString()
  return readings.filter((r) => r.timestamp >= cutoff)
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
  const range = rawRange && rawRange in RANGES ? rawRange : '7d'

  const [meta, config] = await Promise.all([getSensorMeta(sensorId), getConfig()])
  if (!meta) notFound()

  const { fromDate, toDate } = getRangeDates(range)
  let readings = await getReadings(sensorId, fromDate, toDate)
  if (range === '1h') readings = filterByHours(readings, 1)

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
            <h1 className="text-lg font-semibold text-foreground">{meta.name}</h1>
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

      {/* Metadata + remote config side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SensorMetaPanel meta={meta} editAction={metaAction} />
        <SensorIntervalForm desiredInterval={meta.desiredInterval} setAction={intervalAction} />
      </div>

      {/* Chart controls */}
      <div className="flex items-center gap-2">
        {Object.entries(RANGES).map(([key, { label }]) => (
          <Link
            key={key}
            href={`/sensors/${sensorId}?range=${key}`}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              range === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <SensorChartLive
        key={range}
        sensorId={sensorId}
        range={range}
        initialReadings={readings}
        config={config}
      />
    </div>
  )
}
