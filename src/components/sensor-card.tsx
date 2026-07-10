import Link from 'next/link'
import { Thermometer, Droplets, Clock, MapPin } from 'lucide-react'
import type { SensorMeta, SensorReading, AppConfig } from '@/lib/types'
import { formatTemperature, formatHumidity } from '@/lib/units'

interface Props {
  meta: SensorMeta
  latest: SensorReading | null
  config: AppConfig
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function SensorCard({ meta, latest, config }: Props) {
  const temp = latest?.data.temperature
  const humidity = latest?.data.humidity

  const locationParts = [meta.location, meta.zone].filter(Boolean)

  return (
    <Link
      href={`/sensors/${meta.id}`}
      className="block rounded-lg border border-border bg-card p-4 hover:border-primary transition-colors"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <h2 className="font-semibold text-foreground">{meta.name}</h2>
        {latest && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Clock size={12} />
            {timeAgo(latest.timestamp)}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground font-mono mb-2">{meta.id}</p>

      {locationParts.length > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <MapPin size={11} className="text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">{locationParts.join(' · ')}</span>
          {meta.floor != null && (
            <span className="text-xs text-muted-foreground">· Floor {meta.floor}</span>
          )}
        </div>
      )}

      {latest ? (
        <div className="flex flex-wrap gap-4">
          {temp && (
            <div className="flex items-center gap-1.5">
              <Thermometer size={16} className="text-primary" />
              <span className="text-lg font-medium tabular-nums">
                {formatTemperature(temp.value, temp.unit, config.temperatureUnit)}
              </span>
            </div>
          )}
          {humidity && (
            <div className="flex items-center gap-1.5">
              <Droplets size={16} className="text-primary" />
              <span className="text-lg font-medium tabular-nums">
                {formatHumidity(humidity.value)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No readings yet</p>
      )}
    </Link>
  )
}
