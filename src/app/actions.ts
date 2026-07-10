'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { saveConfig, deleteSensorData, updateSensorMeta, updateDesiredInterval } from '@/lib/storage'

const ConfigSchema = z.object({
  temperatureUnit: z.enum(['C', 'F', 'K']),
  truncationDays: z.coerce.number().int().min(1).max(365),
})

export async function updateConfigAction(
  _prev: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const result = ConfigSchema.safeParse({
    temperatureUnit: formData.get('temperatureUnit'),
    truncationDays: formData.get('truncationDays'),
  })
  if (!result.success) {
    return { error: result.error.flatten().fieldErrors.temperatureUnit?.[0] ?? 'Invalid values' }
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
