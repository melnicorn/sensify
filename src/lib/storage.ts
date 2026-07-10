import 'server-only'
import { promises as fs } from 'fs'
import path from 'path'
import type { SensorReading, SensorMeta, AppConfig } from './types'
import type { ReadingInput } from './schemas'

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')

function sensorsDir() {
  return path.join(DATA_DIR, 'sensors')
}
function sensorDir(sensorId: string) {
  return path.join(sensorsDir(), sensorId)
}
function readingsDir(sensorId: string) {
  return path.join(sensorDir(sensorId), 'readings')
}
function dailyFile(sensorId: string, dateStr: string) {
  return path.join(readingsDir(sensorId), `${dateStr}.json`)
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(filePath: string, data: unknown) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2))
}

export async function saveReading(
  input: ReadingInput,
  callerIp: string
): Promise<{ reading: SensorReading; desiredConfig: { interval: number } | null }> {
  const now = new Date().toISOString()
  const reading: SensorReading = {
    id: crypto.randomUUID(),
    sensorId: input.sensorId,
    sensorName: input.sensorName,
    timestamp: now,
    data: input.data,
  }

  const rDir = readingsDir(input.sensorId)
  await ensureDir(rDir)

  const dateStr = now.substring(0, 10)
  const existing = await readJson<SensorReading[]>(dailyFile(input.sensorId, dateStr), [])
  existing.push(reading)
  await writeJson(dailyFile(input.sensorId, dateStr), existing)

  // Upsert sensor metadata
  const metaPath = path.join(sensorDir(input.sensorId), 'meta.json')
  const storedMeta = await readJson<SensorMeta | null>(metaPath, null)
  const isNew = storedMeta === null
  const meta: SensorMeta = storedMeta ?? {
    id: input.sensorId,
    name: input.sensorName, // seeded from device on first registration only
    firstSeen: now,
    lastSeen: now,
  }
  meta.lastSeen = now
  meta.lastIp = callerIp
  // Device-supplied meta seeds all fields on first registration.
  // On subsequent POSTs, device updates all fields EXCEPT name — the UI owns that.
  if (input.meta) {
    if (isNew || input.meta.location !== undefined) meta.location = input.meta.location
    if (isNew || input.meta.floor !== undefined) meta.floor = input.meta.floor
    if (isNew || input.meta.zone !== undefined) meta.zone = input.meta.zone
    if (isNew || input.meta.description !== undefined) meta.description = input.meta.description
    if (isNew || input.meta.hardware !== undefined) meta.hardware = input.meta.hardware
    if (isNew || input.meta.tags !== undefined) meta.tags = input.meta.tags
  }
  await writeJson(metaPath, meta)

  const config = await getConfig()
  await truncate(input.sensorId, config.truncationDays)

  const desiredConfig =
    meta.desiredInterval != null ? { interval: meta.desiredInterval } : null

  return { reading, desiredConfig }
}

async function truncate(sensorId: string, days: number) {
  const rDir = readingsDir(sensorId)
  try {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().substring(0, 10)
    const files = await fs.readdir(rDir)
    for (const file of files) {
      if (file.endsWith('.json') && file.replace('.json', '') < cutoffStr) {
        await fs.unlink(path.join(rDir, file))
      }
    }
  } catch {
    // directory may not exist yet
  }
}

export async function listSensors(): Promise<SensorMeta[]> {
  try {
    const entries = await fs.readdir(sensorsDir(), { withFileTypes: true })
    const metas = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map((e) =>
          readJson<SensorMeta | null>(path.join(sensorsDir(), e.name, 'meta.json'), null)
        )
    )
    return (metas.filter(Boolean) as SensorMeta[]).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export async function getSensorMeta(sensorId: string): Promise<SensorMeta | null> {
  return readJson<SensorMeta | null>(path.join(sensorDir(sensorId), 'meta.json'), null)
}

export async function updateSensorMeta(
  sensorId: string,
  updates: {
    name?: string
    location?: string
    floor?: number | null
    zone?: string
    description?: string
    hardware?: string
    tags?: string[]
  }
): Promise<void> {
  const metaPath = path.join(sensorDir(sensorId), 'meta.json')
  const meta = await readJson<SensorMeta | null>(metaPath, null)
  if (!meta) throw new Error(`Sensor ${sensorId} not found`)
  Object.assign(meta, updates)
  await writeJson(metaPath, meta)
}

export async function updateDesiredInterval(
  sensorId: string,
  interval: number | null
): Promise<void> {
  const metaPath = path.join(sensorDir(sensorId), 'meta.json')
  const meta = await readJson<SensorMeta | null>(metaPath, null)
  if (!meta) throw new Error(`Sensor ${sensorId} not found`)
  meta.desiredInterval = interval
  await writeJson(metaPath, meta)
}

export async function getReadings(
  sensorId: string,
  fromDate: string,
  toDate: string
): Promise<SensorReading[]> {
  const rDir = readingsDir(sensorId)
  try {
    const files = await fs.readdir(rDir)
    const results: SensorReading[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const dateStr = file.replace('.json', '')
      if (dateStr >= fromDate && dateStr <= toDate) {
        const day = await readJson<SensorReading[]>(path.join(rDir, file), [])
        results.push(...day)
      }
    }
    return results.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  } catch {
    return []
  }
}

export async function getLatestReading(sensorId: string): Promise<SensorReading | null> {
  const rDir = readingsDir(sensorId)
  try {
    const files = (await fs.readdir(rDir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const day = await readJson<SensorReading[]>(path.join(rDir, file), [])
      if (day.length > 0) return day[day.length - 1] ?? null
    }
  } catch {
    // no data
  }
  return null
}

export async function deleteSensorData(sensorId: string): Promise<void> {
  await fs.rm(sensorDir(sensorId), { recursive: true, force: true })
}

export async function getConfig(): Promise<AppConfig> {
  return readJson<AppConfig>(path.join(DATA_DIR, 'config.json'), {
    temperatureUnit: 'F',
    truncationDays: 30,
  })
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureDir(DATA_DIR)
  await writeJson(path.join(DATA_DIR, 'config.json'), config)
}
