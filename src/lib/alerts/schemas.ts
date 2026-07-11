import { z } from 'zod'

// ---------- rule definitions ----------
// A rule definition is versioned JSON stored in alert_rules.definition. The
// trigger is a discriminated union on `kind`; new trigger kinds (staleness,
// composite, sequence, ...) add a schema here and an evaluator in engine.ts
// without touching the lifecycle machinery. Never repurpose `v: 1` — breaking
// shape changes bump the version and add an upgrade step in parseDefinition.

export const AggSchema = z.enum(['avg', 'min', 'max', 'last'])
export type Agg = z.infer<typeof AggSchema>

export const OpSchema = z.enum(['>', '>=', '<', '<='])
export type Op = z.infer<typeof OpSchema>

export const ConditionSchema = z.object({
  op: OpSchema,
  value: z.number().finite(), // canonical units (°C for temperatures)
  holdS: z.number().int().min(0).max(86400).default(0), // dwell before the transition commits
})
export type Condition = z.infer<typeof ConditionSchema>

export const LevelTriggerSchema = z.object({
  kind: z.literal('level'),
  metric: z.string().min(1).max(64),
  // Time-weighted aggregate over a trailing window; windowS 0 = latest value
  signal: z.object({
    agg: AggSchema,
    windowS: z.number().int().min(0).max(3600),
  }),
  start: ConditionSchema,
  // Defaults to the negation of `start` (same value, opposite op, holdS 0)
  end: ConditionSchema.optional(),
})
export type LevelTrigger = z.infer<typeof LevelTriggerSchema>

export const TriggerSchema = z.discriminatedUnion('kind', [LevelTriggerSchema])
export type Trigger = z.infer<typeof TriggerSchema>

export const RuleDefinitionSchema = z.object({
  v: z.literal(1),
  trigger: TriggerSchema,
  cooldownS: z.number().int().min(0).max(86400).default(0),
  // Message templates: absent = built-in default, null = that notification
  // is disabled (level-shift patterns fire on start only)
  notify: z
    .object({
      onStart: z.string().max(500).nullable().optional(),
      onEnd: z.string().max(500).nullable().optional(),
    })
    .default({}),
})
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>

/** Parse a stored definition. Returns an error string instead of throwing so
 *  a bad rule can be surfaced in the UI without breaking ingest. */
export function parseDefinition(
  json: string
): { def: RuleDefinition; error: null } | { def: null; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { def: null, error: 'Definition is not valid JSON' }
  }
  // Future: if (raw.v === 1 && CURRENT_V === 2) raw = upgradeV1toV2(raw)
  const result = RuleDefinitionSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    return { def: null, error: `${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}` }
  }
  return { def: result.data, error: null }
}

// ---------- lifecycle ----------

export const PHASES = ['idle', 'pending', 'active', 'clearing', 'cooldown'] as const
export type Phase = (typeof PHASES)[number]

export interface EventStats {
  count: number
  min: number
  max: number
  sum: number // avg derived as sum / count
  last: number
}

// ---------- notification channels ----------

export const ChannelTypeSchema = z.enum(['telegram'])
export type ChannelType = z.infer<typeof ChannelTypeSchema>

export const TelegramConfigSchema = z.object({
  botToken: z.string().trim().min(10).max(200),
  chatId: z.string().trim().min(1).max(64),
})

export const CHANNEL_CONFIG_SCHEMAS: Record<ChannelType, z.ZodType<Record<string, string>>> = {
  telegram: TelegramConfigSchema,
}
