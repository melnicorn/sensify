'use client'

import { useTheme } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import type { MetricReading, SensorMeta, AppConfig } from '@/lib/types'
import { convertTemperature, metricDisplayInfo, metricLabel } from '@/lib/units'

export interface TimeSelection {
  from: number // epoch ms
  to: number // epoch ms
}

interface Props {
  readings: MetricReading[]
  meta: SensorMeta
  config: AppConfig
  selection?: TimeSelection | null
  onSelectionChange?: (selection: TimeSelection | null) => void
}

interface Series {
  metric: string
  title: string
  unitLabel: string
  points: { ts: number; value: number }[]
}

function buildSeries(readings: MetricReading[], meta: SensorMeta, config: AppConfig): Series[] {
  const byMetric = new Map<string, MetricReading[]>()
  for (const r of readings) {
    const list = byMetric.get(r.metric)
    if (list) list.push(r)
    else byMetric.set(r.metric, [r])
  }

  const series: Series[] = []
  for (const [metric, rows] of byMetric) {
    // Temperatures are stored canonically in °C (push and recognized pull
    // fields alike) and converted to the configured display unit here
    const { isTemp, unit } = metricDisplayInfo(meta, config, metric)
    series.push({
      metric,
      title: unit ? `${metricLabel(metric)} (${unit})` : metricLabel(metric),
      unitLabel: unit,
      points: rows.map((r) => ({
        ts: Date.parse(r.ts),
        value: parseFloat(
          (isTemp ? convertTemperature(r.value, 'C', config.temperatureUnit) : r.value).toFixed(2)
        ),
      })),
    })
  }

  // Stable order: pull field order if configured, else alphabetical
  const fieldOrder = meta.pull?.fields.map((f) => f.metric) ?? []
  series.sort((a, b) => {
    const ai = fieldOrder.indexOf(a.metric)
    const bi = fieldOrder.indexOf(b.metric)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.metric.localeCompare(b.metric)
  })
  return series
}

function formatTick(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const LINE_COLORS = {
  light: ['#2563eb', '#0891b2', '#d97706', '#7c3aed', '#059669', '#dc2626'],
  dark: ['#22d3ee', '#67e8f9', '#fbbf24', '#a78bfa', '#34d399', '#f87171'],
}

export function SensorChart({ readings, meta, config, selection, onSelectionChange }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [logScaleMetrics, setLogScaleMetrics] = useState<Record<string, boolean>>({})
  // In-progress click-drag on any of the metric charts (they share a time
  // axis). The pressed-but-not-yet-moved position lives in a ref so a plain
  // tap never triggers a state update — rerendering on tap dismisses the
  // tooltip, which makes inspecting data points on touch screens impossible.
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null)
  const pressedTs = useRef<number | null>(null)
  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="h-64 rounded-lg bg-muted animate-pulse" />

  const isDark = resolvedTheme === 'dark'
  const colors = {
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#a5f3fc' : '#64748b',
    tooltip: isDark ? '#0a2329' : '#ffffff',
    tooltipBorder: isDark ? '#164e63' : '#e2e8f0',
    selection: isDark ? '#22d3ee' : '#2563eb',
  }
  const palette = isDark ? LINE_COLORS.dark : LINE_COLORS.light

  if (readings.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center rounded-lg border border-border bg-muted/30">
        <p className="text-sm text-muted-foreground">No readings in this range</p>
      </div>
    )
  }

  const series = buildSeries(readings, meta, config)
  const selectable = onSelectionChange !== undefined

  const activeTs = (e: unknown): number | null => {
    const label = (e as { activeLabel?: string | number } | null)?.activeLabel
    if (label === undefined || label === null) return null
    const ts = Number(label)
    return isNaN(ts) ? null : ts
  }

  const handleMouseDown = (e: unknown) => {
    if (!selectable) return
    pressedTs.current = activeTs(e)
  }

  const handleMouseMove = (e: unknown) => {
    const start = pressedTs.current
    if (start === null) return
    const ts = activeTs(e)
    if (ts === null) return
    // Drag state (and its rerender) starts only once the pointer actually moves
    if (!drag) {
      if (ts !== start) setDrag({ start, end: ts })
    } else if (ts !== drag.end) {
      setDrag({ start: drag.start, end: ts })
    }
  }

  const handleMouseUp = () => {
    const pressed = pressedTs.current
    pressedTs.current = null
    if (pressed === null) return
    if (drag) {
      onSelectionChange?.({
        from: Math.min(drag.start, drag.end),
        to: Math.max(drag.start, drag.end),
      })
      setDrag(null)
    } else if (selection) {
      // A click without dragging clears any existing selection
      onSelectionChange?.(null)
    }
  }

  // The pending drag takes visual precedence over a committed selection
  const highlight = drag
    ? { from: Math.min(drag.start, drag.end), to: Math.max(drag.start, drag.end) }
    : (selection ?? null)

  const commonAxis = {
    tick: { fill: colors.text, fontSize: 11 },
    axisLine: { stroke: colors.grid },
    tickLine: { stroke: colors.grid },
  }

  return (
    <div className="space-y-6">
      {series.map((s, i) => {
        const hasNonPositive = s.points.some((p) => p.value <= 0)
        const isLog = (logScaleMetrics[s.metric] || false) && !hasNonPositive

        return (
          <div key={s.metric} className={selectable ? 'select-none [&_svg]:cursor-crosshair' : ''}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-muted-foreground">{s.title}</h3>
              <div className="flex items-center gap-1 bg-muted p-0.5 rounded-lg text-xs border border-border/50">
                <button
                  onClick={() => setLogScaleMetrics((prev) => ({ ...prev, [s.metric]: false }))}
                  className={`px-2 py-1 rounded-md transition-all duration-200 ${
                    !isLog
                      ? 'bg-card text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Linear
                </button>
                <button
                  disabled={hasNonPositive}
                  onClick={() => setLogScaleMetrics((prev) => ({ ...prev, [s.metric]: true }))}
                  className={`px-2 py-1 rounded-md transition-all duration-200 ${
                    isLog
                      ? 'bg-card text-foreground shadow-sm font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  } ${hasNonPositive ? 'opacity-40 cursor-not-allowed' : ''}`}
                  title={hasNonPositive ? 'Log scale is only supported for strictly positive values' : undefined}
                >
                  Log
                </button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={s.points}
                margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={formatTick}
                  {...commonAxis}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis
                  {...commonAxis}
                  width={60}
                  scale={isLog ? 'log' : 'auto'}
                  domain={
                    isLog
                      ? [
                          (min: number) => {
                            const adjustedMin = min * 0.9
                            return adjustedMin > 0 ? adjustedMin : 0.1
                          },
                          (max: number) => max * 1.1 || 1,
                        ]
                      : [
                          (min: number) => Math.floor(min * 0.98),
                          (max: number) => Math.ceil(max * 1.02) || 1,
                        ]
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: colors.tooltip,
                    border: `1px solid ${colors.tooltipBorder}`,
                    borderRadius: '6px',
                    fontSize: 12,
                    color: isDark ? '#ecfeff' : '#0f172a',
                  }}
                  labelFormatter={(ts: number) => new Date(ts).toLocaleString()}
                  formatter={(v: number) => [
                    s.unitLabel ? `${v} ${s.unitLabel}` : String(v),
                    metricLabel(s.metric),
                  ]}
                />
                {highlight && (
                  <ReferenceArea
                    x1={highlight.from}
                    x2={highlight.to}
                    ifOverflow="visible"
                    fill={colors.selection}
                    fillOpacity={0.12}
                    stroke={colors.selection}
                    strokeOpacity={0.4}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={palette[i % palette.length]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  animationDuration={300}
                  animationEasing="ease-out"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )
      })}
    </div>
  )
}
