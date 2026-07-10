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
  Legend,
} from 'recharts'
import type { SensorReading, AppConfig } from '@/lib/types'
import { convertTemperature } from '@/lib/units'

interface ChartPoint {
  time: string
  temperature?: number
  humidity?: number
}

interface Props {
  readings: SensorReading[]
  config: AppConfig
}

function buildChartData(readings: SensorReading[], displayUnit: AppConfig['temperatureUnit']): ChartPoint[] {
  return readings.map((r) => {
    const point: ChartPoint = {
      time: new Date(r.timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }
    if (r.data.temperature) {
      point.temperature = parseFloat(
        convertTemperature(r.data.temperature.value, r.data.temperature.unit, displayUnit).toFixed(1)
      )
    }
    if (r.data.humidity) {
      point.humidity = parseFloat(r.data.humidity.value.toFixed(1))
    }
    return point
  })
}

export function SensorChart({ readings, config }: Props) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="h-64 rounded-lg bg-muted animate-pulse" />

  const isDark = resolvedTheme === 'dark'
  const colors = {
    temperature: isDark ? '#22d3ee' : '#2563eb',
    humidity: isDark ? '#67e8f9' : '#0891b2',
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#a5f3fc' : '#64748b',
    tooltip: isDark ? '#0a2329' : '#ffffff',
    tooltipBorder: isDark ? '#164e63' : '#e2e8f0',
  }

  const data = buildChartData(readings, config.temperatureUnit)

  const hasTemp = readings.some((r) => r.data.temperature !== undefined)
  const hasHumidity = readings.some((r) => r.data.humidity !== undefined)

  if (readings.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center rounded-lg border border-border bg-muted/30">
        <p className="text-sm text-muted-foreground">No readings in this range</p>
      </div>
    )
  }

  const commonAxis = {
    tick: { fill: colors.text, fontSize: 11 },
    axisLine: { stroke: colors.grid },
    tickLine: { stroke: colors.grid },
  }

  return (
    <div className="space-y-6">
      {hasTemp && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            Temperature (°{config.temperatureUnit})
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" {...commonAxis} interval="preserveStartEnd" />
              <YAxis
                {...commonAxis}
                width={52}
                unit={`°${config.temperatureUnit}`}
                domain={[
                  (min: number) => Math.floor(min) - 2,
                  (max: number) => Math.ceil(max) + 2,
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
                formatter={(v: number) => [`${v}°${config.temperatureUnit}`, 'Temperature']}
              />
              <Line
                type="monotone"
                dataKey="temperature"
                stroke={colors.temperature}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasHumidity && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Humidity (%)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis dataKey="time" {...commonAxis} interval="preserveStartEnd" />
              <YAxis
                {...commonAxis}
                width={52}
                unit="%"
                domain={[
                  (min: number) => Math.max(0, Math.floor(min) - 2),
                  (max: number) => Math.min(100, Math.ceil(max) + 2),
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
                formatter={(v: number) => [`${v}%`, 'Humidity']}
              />
              <Line
                type="monotone"
                dataKey="humidity"
                stroke={colors.humidity}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
