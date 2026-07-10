export interface TemperatureData {
  value: number
  unit: 'C' | 'F' | 'K'
}

export interface HumidityData {
  value: number
}

export interface SensorData {
  temperature?: TemperatureData
  humidity?: HumidityData
}

export interface SensorReading {
  id: string
  sensorId: string
  sensorName: string
  timestamp: string // ISO 8601, set by server on receipt
  data: SensorData
}

export interface SensorMeta {
  id: string
  name: string
  firstSeen: string
  lastSeen: string
  lastIp?: string
  // physical / display metadata (seeded by device, editable in UI)
  location?: string
  floor?: number | null
  zone?: string
  description?: string
  hardware?: string
  tags?: string[]
  // remote config: set by UI, returned to device on next POST
  desiredInterval?: number | null
}

export interface AppConfig {
  temperatureUnit: 'C' | 'F' | 'K'
  truncationDays: number
}
