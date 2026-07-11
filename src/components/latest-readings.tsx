'use client'

// Stat tiles for the most recent value of each metric, refreshed at the
// device's own cadence (same estimate the live chart uses).
import { useEffect, useState } from 'react'
import { Thermometer, Droplets, Gauge } from 'lucide-react'
import { devicePeriodMs, formatPeriod } from '@/lib/device-period'
import { convertTemperature, formatMetricValue, metricDisplayInfo, metricLabel } from '@/lib/units'
import type { LatestMetric, SensorMeta, AppConfig } from '@/lib/types'

const REFRESH_FLOOR_MS = 5_000
const REFRESH_CAP_MS = 300_000

function timeAgo(isoStr: string, nowMs: number): string {
  const diff = nowMs - Date.parse(isoStr)
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function MetricIcon({ meta, metric }: { meta: SensorMeta; metric: string }) {
  const isTemp =
    (meta.type === 'push' && metric === 'temperature') ||
    meta.pull?.fields.find((f) => f.metric === metric)?.unitKind === 'temperature'
  if (isTemp) return <Thermometer size={14} className="text-primary shrink-0" />
  if (meta.type === 'push' && metric === 'humidity')
    return <Droplets size={14} className="text-primary shrink-0" />
  return <Gauge size={14} className="text-primary shrink-0" />
}

interface Props {
  meta: SensorMeta
  config: AppConfig
  initial: LatestMetric[]
}

export function LatestReadings({ meta, config, initial }: Props) {
  const [latest, setLatest] = useState(initial)
  // Set after mount so time-ago strings never mismatch the server render,
  // then bumped on every refresh tick to keep them current
  const [nowMs, setNowMs] = useState<number | null>(null)

  const refreshMs = Math.min(
    Math.max(devicePeriodMs(meta, []), REFRESH_FLOOR_MS),
    REFRESH_CAP_MS
  )

  useEffect(() => {
    setNowMs(Date.now())
    async function refresh() {
      try {
        const res = await fetch(`/api/v1/sensors/${meta.id}/latest`)
        if (!res.ok) return
        setLatest((await res.json()) as LatestMetric[])
      } catch {
        // keep showing last known values on network error
      } finally {
        setNowMs(Date.now())
      }
    }
    const timer = setInterval(refresh, refreshMs)
    return () => clearInterval(timer)
  }, [meta.id, refreshMs])

  if (latest.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">Latest readings</h2>
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title={`Refreshes every ${formatPeriod(refreshMs)}, based on the device's data period`}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse" />
          Live · {formatPeriod(refreshMs)}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {latest.map((m) => {
          const { isTemp, unit } = metricDisplayInfo(meta, config, m.metric)
          const display = isTemp
            ? convertTemperature(m.value, 'C', config.temperatureUnit).toFixed(1)
            : formatMetricValue(m.value)
          return (
            <div key={m.metric} className="rounded-md border border-border bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MetricIcon meta={meta} metric={m.metric} />
                <span className="truncate">{metricLabel(m.metric)}</span>
              </p>
              <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums leading-tight">
                {display}
                {unit && (
                  <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
                )}
              </p>
              {nowMs !== null && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(m.ts, nowMs)}</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
