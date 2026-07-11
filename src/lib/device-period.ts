// Client-safe estimate of a device's data cadence, shared by the live chart
// and the latest-readings panel so both refresh at the device's own pace.
import type { MetricReading, SensorMeta } from './types'

export const FALLBACK_PERIOD_MS = 30_000

/** How often the device produces data: pull poll interval, push desired
 *  interval, or (for push devices without one) the median spacing of the
 *  readings we already have. */
export function devicePeriodMs(meta: SensorMeta, readings: MetricReading[]): number {
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

export function formatPeriod(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return `${m}m`
}
