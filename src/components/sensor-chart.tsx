'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { MetricReading, SensorMeta, AppConfig } from '@/lib/types'
import { convertTemperature, metricLabel } from '@/lib/units'

interface Props {
  readings: MetricReading[]
  meta: SensorMeta
  config: AppConfig
}

interface Series {
  metric: string
  title: string
  unitLabel: string
  points: { time: string; value: number }[]
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
    const isPushTemp = meta.type === 'push' && metric === 'temperature'
    const isPushHumidity = meta.type === 'push' && metric === 'humidity'
    const unit = isPushTemp
      ? `°${config.temperatureUnit}`
      : isPushHumidity
        ? '%'
        : (meta.pull?.fields.find((f) => f.metric === metric)?.unit ?? '')
    series.push({
      metric,
      title: unit ? `${metricLabel(metric)} (${unit})` : metricLabel(metric),
      unitLabel: unit,
      points: rows.map((r) => ({
        time: new Date(r.ts).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        value: parseFloat(
          (isPushTemp
            ? convertTemperature(r.value, 'C', config.temperatureUnit)
            : r.value
          ).toFixed(2)
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

const LINE_COLORS = {
  light: ['#2563eb', '#0891b2', '#d97706', '#7c3aed', '#059669', '#dc2626'],
  dark: ['#22d3ee', '#67e8f9', '#fbbf24', '#a78bfa', '#34d399', '#f87171'],
}

export function SensorChart({ readings, meta, config }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="h-64 rounded-lg bg-muted animate-pulse" />

  const isDark = resolvedTheme === 'dark'
  const colors = {
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#a5f3fc' : '#64748b',
    tooltip: isDark ? '#0a2329' : '#ffffff',
    tooltipBorder: isDark ? '#164e63' : '#e2e8f0',
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

  const commonAxis = {
    tick: { fill: colors.text, fontSize: 11 },
    axisLine: { stroke: colors.grid },
    tickLine: { stroke: colors.grid },
  }

  return (
    <div className="space-y-6">
      {series.map((s, i) => (
        <div key={s.metric}>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">{s.title}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={s.points} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" {...commonAxis} interval="preserveStartEnd" />
              <YAxis
                {...commonAxis}
                width={60}
                domain={[
                  (min: number) => Math.floor(min * 0.98),
                  (max: number) => Math.ceil(max * 1.02) || 1,
                ]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: colors.tooltip,
                  border: `1px solid ${colors.tooltipBorder}`,
                  borderRadius: '6px',
                  fontSize: 12,
                  color: isDark ? '#ecfeff' : '#0f172a',
                }}
                formatter={(v: number) => [
                  s.unitLabel ? `${v} ${s.unitLabel}` : String(v),
                  metricLabel(s.metric),
                ]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={palette[i % palette.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  )
}
