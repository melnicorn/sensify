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
