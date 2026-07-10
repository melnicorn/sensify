import { z } from 'zod'

export const TemperatureDataSchema = z.object({
  value: z.number().finite(),
  unit: z.enum(['C', 'F', 'K']),
})

export const HumidityDataSchema = z.object({
  value: z.number().min(0).max(100),
})

export const SensorDataSchema = z
  .object({
    temperature: TemperatureDataSchema.optional(),
    humidity: HumidityDataSchema.optional(),
  })
  .refine((d) => d.temperature !== undefined || d.humidity !== undefined, {
    message: 'At least one sensor measurement is required',
  })

export const SensorMetaInputSchema = z.object({
  location: z.string().max(128).optional(),
  floor: z.number().int().min(-99).max(999).nullable().optional(),
  zone: z.string().max(64).optional(),
  description: z.string().max(512).optional(),
  hardware: z.string().max(128).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
})

// Payload from external callers — no timestamp (server sets it on receipt)
export const ReadingInputSchema = z.object({
  sensorId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'sensorId must be alphanumeric (dashes and underscores allowed)'),
  sensorName: z.string().min(1).max(128),
  meta: SensorMetaInputSchema.optional(),
  data: SensorDataSchema,
})

export type ReadingInput = z.infer<typeof ReadingInputSchema>
export type SensorMetaInput = z.infer<typeof SensorMetaInputSchema>

// ---------- pull devices ----------

export const PullFieldSchema = z.object({
  path: z.string().min(1).max(256),
  metric: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Metric name must be alphanumeric (dots, dashes, underscores allowed)'),
  unit: z.string().max(16).optional(),
})

export const PullDeviceInputSchema = z.object({
  name: z.string().min(1).max(128),
  url: z
    .string()
    .max(512)
    .url()
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'URL must be http or https',
    }),
  pollInterval: z.number().int().min(2).max(86400),
  fields: z
    .array(PullFieldSchema)
    .min(1, 'Select at least one field to record')
    .max(50)
    .refine((fields) => new Set(fields.map((f) => f.metric)).size === fields.length, {
      message: 'Metric names must be unique',
    }),
})

export type PullDeviceInput = z.infer<typeof PullDeviceInputSchema>
