'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { X } from 'lucide-react'
import { SensorChart, type TimeSelection } from './sensor-chart'
import { ExportMenu } from './export-menu'
import type { MetricReading, SensorMeta, AppConfig } from '@/lib/types'

// Widest ranges refresh least aggressively — a single new point barely moves them
const RANGE_FLOOR_MS: Record<string, number> = {
  '1h': 5_000,
  '24h': 30_000,
  '7d': 120_000,
  '30d': 300_000,
}
const MAX_REFRESH_MS = 300_000
const FALLBACK_PERIOD_MS = 30_000

/** How often the device produces data: pull poll interval, push desired
 *  interval, or (for push devices without one) the median spacing of the
 *  readings we already have. */
function devicePeriodMs(meta: SensorMeta, readings: MetricReading[]): number {
  if (meta.type === 'pull' && meta.pull) return meta.pull.pollInterval * 1000
  if (meta.desiredInterval) return meta.desiredInterval * 1000
  const ts = [...new Set(readings.map((r) => r.ts))].sort().slice(-50).map((t) => Date.parse(t))
  const deltas = ts
    .slice(1)
    .map((t, i) => t - ts[i]!)
    .filter((d) => d > 0)
    .sort((a, b) => a - b)
  return deltas.length ? deltas[Math.floor(deltas.length / 2)]! : FALLBACK_PERIOD_MS
}

function formatPeriod(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return `${m}m`
}

interface Props {
  meta: SensorMeta
  range: string
  initialReadings: MetricReading[]
  config: AppConfig
}

export function SensorChartLive({ meta, range, initialReadings, config }: Props) {
  const [readings, setReadings] = useState(initialReadings)
  const [selection, setSelection] = useState<TimeSelection | null>(null)
  const [pulse, setPulse] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Reset to server-fetched data whenever range changes
    setReadings(initialReadings)
  }, [initialReadings])

  // Refresh at the device's own cadence, but no faster than the range floor
  const refreshMs = useMemo(
    () =>
      Math.min(
        Math.max(devicePeriodMs(meta, initialReadings), RANGE_FLOOR_MS[range] ?? FALLBACK_PERIOD_MS),
        MAX_REFRESH_MS
      ),
    [meta, range, initialReadings]
  )

  useEffect(() => {
    async function refresh() {
      try {
        const res = await fetch(`/api/v1/sensors/${meta.id}/readings?range=${range}`)
        if (!res.ok) return
        const data: MetricReading[] = await res.json()
        setReadings(data)
        // Brief pulse to signal the chart just updated
        setPulse(true)
        setTimeout(() => setPulse(false), 1000)
      } catch {
        // keep showing last known data on network error
      }
    }

    timerRef.current = setInterval(refresh, refreshMs)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [meta.id, range, refreshMs])

  const pointCount = new Set(readings.map((r) => r.ts)).size

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3">
        {selection && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="text-foreground">
              {new Date(selection.from).toLocaleString()} – {new Date(selection.to).toLocaleString()}
            </span>
            selected
            <button
              onClick={() => setSelection(null)}
              title="Clear selection"
              className="p-0.5 rounded hover:bg-muted hover:text-foreground transition-colors"
            >
              <X size={12} />
            </button>
          </span>
        )}
        <span className="text-xs text-muted-foreground">{pointCount} readings</span>
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title={`Refreshes every ${formatPeriod(refreshMs)}, based on the device's data period and the selected range`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
              pulse ? 'bg-primary' : 'bg-primary/40'
            } animate-pulse`}
          />
          Live · {formatPeriod(refreshMs)}
        </span>
        <ExportMenu sensorId={meta.id} range={range} selection={selection} />
      </div>
      <SensorChart
        readings={readings}
        meta={meta}
        config={config}
        selection={selection}
        onSelectionChange={setSelection}
      />
    </div>
  )
}
