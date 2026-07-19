'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import {
  saveConfig,
  deleteSensorData,
  updateSensorMeta,
  updateDesiredInterval,
  createPullSensor,
  updatePullSensor,
  setPullEnabled,
  createMqttSensor,
  updateMqttSensor,
  convertSensorToMqtt,
  deleteReadingsForMetrics,
  setMqttEnabled,
  getSensorMeta,
  getReadings,
  getLatestMetrics,
} from '@/lib/storage'
import { PullDeviceInputSchema, MqttDeviceInputSchema } from '@/lib/schemas'
import { publishRetained } from '@/lib/mqtt-publish'
import { rangeHours } from '@/lib/chart-ranges'
import type { MetricReading, LatestMetric } from '@/lib/types'

// ---------- chart data (client refresh / range switching without navigation) ----------

export async function getReadingsAction(
  sensorId: string,
  range: string
): Promise<MetricReading[]> {
  const now = new Date()
  const from = new Date(now.getTime() - rangeHours(range) * 3_600_000)
  return getReadings(sensorId, from.toISOString(), now.toISOString())
}

export async function getLatestMetricsAction(sensorId: string): Promise<LatestMetric[]> {
  return getLatestMetrics(sensorId)
}

const ConfigSchema = z.object({
  temperatureUnit: z.enum(['C', 'F', 'K']),
  apiToken: z
    .string()
    .trim()
    .min(8, 'API token must be at least 8 characters')
    .max(128, 'API token must be at most 128 characters')
    .regex(/^[\x21-\x7e]+$/, 'API token must be printable ASCII with no spaces'),
})

export async function updateConfigAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const result = ConfigSchema.safeParse({
    temperatureUnit: formData.get('temperatureUnit'),
    apiToken: formData.get('apiToken'),
  })
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid values' }
  }
  await saveConfig(result.data)
  revalidatePath('/', 'layout')
  return { success: true }
}

export async function deleteSensorAction(sensorId: string): Promise<void> {
  await deleteSensorData(sensorId)
  redirect('/')
}

export async function updateSensorMetaAction(
  sensorId: string,
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const floorRaw = (formData.get('floor') as string).trim()
  const floor = floorRaw !== '' ? parseInt(floorRaw, 10) : null
  const tagsRaw = (formData.get('tags') as string).trim()
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : []
  const name = (formData.get('name') as string).trim()
  if (!name) return { error: 'Name is required' }

  await updateSensorMeta(sensorId, {
    name,
    location: (formData.get('location') as string).trim() || undefined,
    floor: floor !== null && isNaN(floor) ? null : floor,
    zone: (formData.get('zone') as string).trim() || undefined,
    description: (formData.get('description') as string).trim() || undefined,
    hardware: (formData.get('hardware') as string).trim() || undefined,
    tags,
  })
  revalidatePath(`/sensors/${sensorId}`)
  return { success: true }
}

// ---------- pull devices ----------

export interface TestPullResult {
  ok: boolean
  status?: number
  latencyMs?: number
  body?: unknown
  error?: string
}

export async function testPullAction(url: string): Promise<TestPullResult> {
  const parsed = z.string().url().safeParse(url)
  if (!parsed.success || !/^https?:\/\//.test(url)) {
    return { ok: false, error: 'Enter a valid http or https URL' }
  }
  const started = Date.now()
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    const latencyMs = Date.now() - started
    if (!res.ok) {
      return { ok: false, status: res.status, latencyMs, error: `Device returned HTTP ${res.status}` }
    }
    const text = await res.text()
    try {
      return { ok: true, status: res.status, latencyMs, body: JSON.parse(text) }
    } catch {
      return { ok: false, status: res.status, latencyMs, error: 'Response is not valid JSON' }
    }
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Connection timed out (5s)'
        : `Connection failed: ${err instanceof Error ? err.message : 'unknown error'}`
    return { ok: false, latencyMs: Date.now() - started, error: message }
  }
}

export interface SavePullDeviceResult {
  id?: string
  error?: string
}

export async function createPullDeviceAction(input: unknown): Promise<SavePullDeviceResult> {
  const result = PullDeviceInputSchema.safeParse(input)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid device configuration' }
  }
  const { lastSample } = extractSample(input)
  const id = await createPullSensor({ ...result.data, lastSample })
  revalidatePath('/')
  return { id }
}

export async function updatePullDeviceAction(
  sensorId: string,
  input: unknown
): Promise<SavePullDeviceResult> {
  const result = PullDeviceInputSchema.safeParse(input)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid device configuration' }
  }
  const { lastSample } = extractSample(input)
  try {
    await updatePullSensor(sensorId, { ...result.data, lastSample })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
  revalidatePath('/')
  revalidatePath(`/sensors/${sensorId}`)
  return { id: sensorId }
}

function extractSample(input: unknown): { lastSample: string | null } {
  if (input && typeof input === 'object' && 'sample' in input) {
    const sample = (input as { sample: unknown }).sample
    if (sample !== undefined && sample !== null) {
      const json = JSON.stringify(sample)
      if (json.length <= 65536) return { lastSample: json }
    }
  }
  return { lastSample: null }
}

export async function setPullEnabledAction(sensorId: string, enabled: boolean): Promise<void> {
  await setPullEnabled(sensorId, enabled)
  revalidatePath(`/sensors/${sensorId}`)
  revalidatePath('/')
}

// ---------- mqtt devices ----------

export async function createMqttSensorAction(input: unknown): Promise<SavePullDeviceResult> {
  const result = MqttDeviceInputSchema.safeParse(input)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid MQTT sensor configuration' }
  }
  // The sample is the raw payload string (already JSON text), stored verbatim
  // so the field mappings can be re-edited later — same role as pull's lastSample.
  const rawSample =
    input && typeof input === 'object' && 'sample' in input
      ? (input as { sample: unknown }).sample
      : null
  const lastSample = typeof rawSample === 'string' ? rawSample.slice(0, 65536) : null
  const id = await createMqttSensor({ ...result.data, lastSample })
  revalidatePath('/')
  return { id }
}

/**
 * Edit an existing MQTT sensor's topics and field mappings.
 *
 * Readings are keyed by (sensor_id, metric), so a metric that is removed or
 * renamed simply stops growing — its history is kept by default. Callers can
 * opt into dropping that history via `deleteRemovedData`, for mappings that
 * never produced anything worth keeping.
 */
export async function updateMqttSensorAction(
  sensorId: string,
  input: unknown,
  options?: { deleteRemovedData?: boolean }
): Promise<SavePullDeviceResult> {
  const result = MqttDeviceInputSchema.safeParse(input)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid MQTT sensor configuration' }
  }
  const rawSample =
    input && typeof input === 'object' && 'sample' in input
      ? (input as { sample: unknown }).sample
      : null
  const lastSample = typeof rawSample === 'string' ? rawSample.slice(0, 65536) : null

  // Which metric series will no longer be written after this edit?
  const before = await getSensorMeta(sensorId)
  const keptMetrics = new Set(result.data.fields.map((f) => f.metric))
  const droppedMetrics = (before?.mqtt?.fields ?? [])
    .map((f) => f.metric)
    .filter((m) => !keptMetrics.has(m))

  try {
    await updateMqttSensor(sensorId, { ...result.data, lastSample })
    if (options?.deleteRemovedData && droppedMetrics.length > 0) {
      await deleteReadingsForMetrics(sensorId, droppedMetrics)
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
  revalidatePath('/')
  revalidatePath(`/sensors/${sensorId}`)
  return { id: sensorId }
}

/** Move an existing pull/push sensor onto MQTT in place, keeping its history. */
export async function convertSensorToMqttAction(
  sensorId: string,
  input: unknown
): Promise<SavePullDeviceResult> {
  const result = MqttDeviceInputSchema.safeParse(input)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid MQTT sensor configuration' }
  }
  const rawSample =
    input && typeof input === 'object' && 'sample' in input
      ? (input as { sample: unknown }).sample
      : null
  const lastSample = typeof rawSample === 'string' ? rawSample.slice(0, 65536) : null
  try {
    await convertSensorToMqtt(sensorId, { ...result.data, lastSample })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Conversion failed' }
  }
  revalidatePath('/')
  revalidatePath(`/sensors/${sensorId}`)
  return { id: sensorId }
}

/**
 * Set an MQTT device's reporting interval and publish it retained to the
 * sensor's config topic — the MQTT counterpart to the push API returning
 * `{ config: { interval } }`. Clearing it removes the retained message.
 */
export async function setMqttConfigIntervalAction(
  sensorId: string,
  interval: number | null
): Promise<{ error?: string; success?: boolean }> {
  if (interval !== null && (!Number.isInteger(interval) || interval < 5 || interval > 86400)) {
    return { error: 'Interval must be between 5 and 86400 seconds' }
  }
  await updateDesiredInterval(sensorId, interval)

  const meta = await getSensorMeta(sensorId)
  const topic = meta?.mqtt?.configTopic
  if (topic) {
    try {
      // An empty payload clears the retained config.
      await publishRetained(topic, interval === null ? '' : JSON.stringify({ interval }))
    } catch (err) {
      return {
        error: `Saved, but publishing to ${topic} failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      }
    }
  }
  revalidatePath(`/sensors/${sensorId}`)
  return { success: true }
}

export async function setMqttEnabledAction(sensorId: string, enabled: boolean): Promise<void> {
  await setMqttEnabled(sensorId, enabled)
  revalidatePath(`/sensors/${sensorId}`)
  revalidatePath('/')
}

export async function updateDesiredIntervalAction(
  sensorId: string,
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const raw = (formData.get('interval') as string).trim()
  if (raw === '') {
    await updateDesiredInterval(sensorId, null)
    revalidatePath(`/sensors/${sensorId}`)
    return { success: true }
  }
  const interval = parseInt(raw, 10)
  if (isNaN(interval) || interval < 5 || interval > 86400) {
    return { error: 'Interval must be between 5 and 86400 seconds' }
  }
  await updateDesiredInterval(sensorId, interval)
  revalidatePath(`/sensors/${sensorId}`)
  return { success: true }
}
