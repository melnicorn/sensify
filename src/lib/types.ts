export type SensorType = 'push' | 'pull' | 'mqtt'
export type TemperatureUnit = 'C' | 'F' | 'K'

// A single JSON field captured from a pull device, mapped to a named metric
export interface PullField {
  path: string // dot/bracket path into the device JSON, e.g. "aenergy.total" or "[0].apower"
  metric: string // unique-per-sensor metric name, e.g. "energy_total"
  unit?: string // optional display label, e.g. "W", "Wh"
  // Set (server-side, from the unit label) when the label resolves to a known
  // dimension. Temperature fields store canonical °C and convert for display.
  unitKind?: 'temperature' | null
}

export interface PullConfig {
  url: string
  pollInterval: number // seconds between polls
  enabled: boolean
  fields: PullField[]
  lastSuccess?: string | null
  lastError?: string | null
  consecutiveFailures: number
  lastSample?: string | null // raw JSON body of the last successful pull (for re-editing field mappings)
}

// MQTT ingest config; present when type === 'mqtt'. Field mappings reuse
// PullField (paths are payload-relative, transport-agnostic); availability
// reuses the same last_success/last_error/consecutive_failures columns as pull.
export interface MqttConfig {
  topic: string // the topic this sensor's readings are published to
  qos: number // subscription QoS (1 for readings)
  enabled: boolean
  fields: PullField[]
  lastSuccess?: string | null
  lastError?: string | null
  consecutiveFailures: number
  lastSample?: string | null // raw payload of the last message (for re-editing field mappings)
}

export interface SensorMeta {
  id: string
  type: SensorType
  name: string
  firstSeen: string
  lastSeen: string
  lastIp?: string
  // physical / display metadata (seeded by device for push, editable in UI)
  location?: string
  floor?: number | null
  zone?: string
  description?: string
  hardware?: string
  tags?: string[]
  // push remote config: set by UI, returned to device on next POST
  desiredInterval?: number | null
  // pull polling config; present when type === 'pull'
  pull?: PullConfig
  // mqtt subscription config; present when type === 'mqtt'
  mqtt?: MqttConfig
}

// One time-series data point. Push sensors write metrics "temperature" (°C)
// and "humidity" (%); pull sensors write whatever their field mappings name.
export interface MetricReading {
  ts: string // ISO 8601, set by server on receipt / poll
  metric: string
  value: number
}

export interface LatestMetric {
  metric: string
  value: number
  ts: string
}

export interface AppConfig {
  temperatureUnit: TemperatureUnit
  // Bearer token devices must send to POST readings. Stored in the config
  // table; seeded from SENSIFY_API_TOKEN env (if set) or generated on first read.
  apiToken: string
}
