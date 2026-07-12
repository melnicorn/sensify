'use client'

import { useState, useEffect, useMemo, useRef, useTransition } from 'react'
import { BellPlus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { SensorChart, type TimeSelection } from './sensor-chart'
import { ExportMenu } from './export-menu'
import { AlertWizard } from './alert-wizard'
import { devicePeriodMs, formatPeriod, FALLBACK_PERIOD_MS } from '@/lib/device-period'
import { RANGES } from '@/lib/chart-ranges'
import { getReadingsAction } from '@/app/actions'
import type { Channel } from '@/lib/alerts/repo'
import type { MetricReading, SensorMeta, AppConfig } from '@/lib/types'

// Widest ranges refresh least aggressively — a single new point barely moves them
const RANGE_FLOOR_MS: Record<string, number> = {
  '1h': 5_000,
  '24h': 30_000,
  '7d': 120_000,
  '30d': 300_000,
}
const MAX_REFRESH_MS = 300_000

interface Props {
  meta: SensorMeta
  initialRange: string
  initialReadings: MetricReading[]
  config: AppConfig
  channels: Channel[]
}

export function SensorChartLive({ meta, initialRange, initialReadings, config, channels }: Props) {
  const [range, setRange] = useState(initialRange)
  const [readings, setReadings] = useState(initialReadings)
  const [selection, setSelection] = useState<TimeSelection | null>(null)
  const [zoom, setZoom] = useState<TimeSelection | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [pulse, setPulse] = useState(false)
  const [isSwitching, startSwitching] = useTransition()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // A server re-render (e.g. after a mutation elsewhere) refreshes the data
    // for the range it rendered — don't clobber a client-side range switch
    if (range === initialRange) setReadings(initialReadings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReadings])

  // Range switching is fully client-side: fetch via server action, keep the
  // URL shareable with shallow history replacement — no navigation, no scroll
  function switchRange(next: string) {
    if (next === range) return
    setSelection(null)
    setZoom(null)
    startSwitching(async () => {
      const data = await getReadingsAction(meta.id, next)
      setRange(next)
      setReadings(data)
      const url = new URL(window.location.href)
      url.searchParams.set('range', next)
      window.history.replaceState(null, '', url)
    })
  }

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
        const data = await getReadingsAction(meta.id, range)
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

  // Zoom is a client-side crop of the loaded readings; the numeric time axis
  // adapts its domain automatically
  const visibleReadings = useMemo(() => {
    if (!zoom) return readings
    return readings.filter((r) => {
      const ts = Date.parse(r.ts)
      return ts >= zoom.from && ts <= zoom.to
    })
  }, [readings, zoom])

  function zoomToSelection() {
    if (!selection) return
    setZoom(selection)
    setSelection(null)
  }

  const pointCount = new Set(visibleReadings.map((r) => r.ts)).size

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {Object.entries(RANGES).map(([key, { label }]) => (
          <button
            key={key}
            onClick={() => switchRange(key)}
            disabled={isSwitching}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              range === key
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            } ${isSwitching ? 'opacity-70' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
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
            <button
              onClick={zoomToSelection}
              title="Zoom the chart to this time frame"
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-border hover:text-foreground hover:bg-muted transition-colors"
            >
              <ZoomIn size={12} />
              Zoom
            </button>
            <button
              onClick={() => setWizardOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <BellPlus size={12} />
              Create alert
            </button>
          </span>
        )}
        {zoom && (
          <button
            onClick={() => setZoom(null)}
            title={`Zoomed to ${new Date(zoom.from).toLocaleString()} – ${new Date(zoom.to).toLocaleString()} — click to show the full range`}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-primary/10 text-primary border border-primary/40 hover:bg-primary/20 transition-colors"
          >
            <ZoomOut size={12} />
            Reset zoom
          </button>
        )}
        {!selection && (
          <button
            onClick={() => setWizardOpen(true)}
            title="Create an alert for this sensor (tip: drag on the chart to fit one from an example event)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border"
          >
            <BellPlus size={14} />
            New alert
          </button>
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
        readings={visibleReadings}
        meta={meta}
        config={config}
        selection={selection}
        onSelectionChange={setSelection}
      />
      {wizardOpen && (
        <AlertWizard
          meta={meta}
          config={config}
          channels={channels}
          readings={readings}
          selection={selection}
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  )
}
