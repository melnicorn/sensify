// Pure message → readings logic for the MQTT ingest, split out so it can be
// unit-tested without a broker or database. index.ts applies the result.
import { getAtPath, isCapturable, toMetricValue } from '../lib/json-path'
import { toCanonicalValue } from '../lib/units'
import { parseMqttPayload, MQTT_MAX_PAYLOAD_CHARS } from '../lib/mqtt-topic'
import type { SensorMeta } from '../lib/types'

export interface ProcessedReading {
  sensorId: string
  sample: string
  metrics: { metric: string; value: number }[]
}

export interface ProcessedFailure {
  sensorId: string
  reason: string
}

export interface ProcessResult {
  retainedDropped: boolean
  persist: ProcessedReading[]
  failures: ProcessedFailure[]
}

/**
 * Turn one MQTT message (for the sensors bound to its topic) into reading
 * writes and soft failures. Pure — no I/O.
 *
 * Retained messages are dropped: the broker replays them on every
 * (re)subscribe, and persisting one would fabricate a reading with a *current*
 * server timestamp for a value that may be minutes old — corrupting charts and
 * tripping the edge-triggered alert engine.
 */
export function processMessage(
  sensors: SensorMeta[],
  payload: Buffer,
  retain: boolean
): ProcessResult {
  if (retain) return { retainedDropped: true, persist: [], failures: [] }

  const full = payload.toString('utf8')
  const raw = full.length > MQTT_MAX_PAYLOAD_CHARS ? full.slice(0, MQTT_MAX_PAYLOAD_CHARS) : full
  const { payload: body, isJson } = parseMqttPayload(raw)

  const persist: ProcessedReading[] = []
  const failures: ProcessedFailure[] = []

  for (const sensor of sensors) {
    const fields = sensor.mqtt?.fields ?? []
    const metrics: { metric: string; value: number }[] = []
    const missing: string[] = []
    for (const f of fields) {
      const rawVal = getAtPath(body, f.path)
      if (isCapturable(rawVal)) {
        // Canonical storage units: temperature fields become °C (as for pull)
        metrics.push({ metric: f.metric, value: toCanonicalValue(toMetricValue(rawVal), f.unit) })
      } else {
        missing.push(f.path)
      }
    }
    if (metrics.length === 0) {
      failures.push({
        sensorId: sensor.id,
        reason: isJson
          ? `No configured fields resolved (${missing.join(', ')})`
          : 'Payload is not JSON',
      })
    } else {
      persist.push({ sensorId: sensor.id, sample: raw, metrics })
    }
  }

  return { retainedDropped: false, persist, failures }
}
