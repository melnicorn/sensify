'use client'

import { useState, useEffect, useRef } from 'react'
import { SensorChart } from './sensor-chart'
import type { SensorReading, AppConfig } from '@/lib/types'

const REFRESH_MS = 30_000

interface Props {
  sensorId: string
  range: string
  initialReadings: SensorReading[]
  config: AppConfig
}

export function SensorChartLive({ sensorId, range, initialReadings, config }: Props) {
  const [readings, setReadings] = useState(initialReadings)
  const [pulse, setPulse] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Reset to server-fetched data whenever range changes
    setReadings(initialReadings)
  }, [initialReadings])

  useEffect(() => {
    async function refresh() {
      try {
        const res = await fetch(`/api/v1/sensors/${sensorId}/readings?range=${range}`)
        if (!res.ok) return
        const data: SensorReading[] = await res.json()
        setReadings(data)
        // Brief pulse to signal the chart just updated
        setPulse(true)
        setTimeout(() => setPulse(false), 1000)
      } catch {
        // keep showing last known data on network error
      }
    }

    timerRef.current = setInterval(refresh, REFRESH_MS)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [sensorId, range])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">{readings.length} readings</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
              pulse ? 'bg-primary' : 'bg-primary/40'
            } animate-pulse`}
          />
          Live
        </span>
      </div>
      <SensorChart readings={readings} config={config} />
    </div>
  )
}
