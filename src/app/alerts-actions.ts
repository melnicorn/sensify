'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  createChannel,
  updateChannel,
  deleteChannel,
  getChannel,
  createRule,
  updateRule,
  setRuleEnabled,
  deleteRule,
  getRule,
} from '@/lib/alerts/repo'
import { sendToChannel } from '@/lib/alerts/channels'
import { RuleDefinitionSchema } from '@/lib/alerts/schemas'

export interface ChannelFormResult {
  error?: string
  success?: boolean
}

const nameField = z.string().trim().min(1, 'Name is required').max(64)

const ChannelFormSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('telegram'),
    name: nameField,
    config: z.object({
      botToken: z.string().trim().min(10, 'Bot token looks too short').max(200),
      chatId: z.string().trim().min(1, 'Chat ID is required').max(64),
    }),
  }),
  z.object({
    type: z.literal('peskybird'),
    name: nameField,
    config: z.object({
      appToken: z.string().trim().min(10, 'App token looks too short').max(200),
      topic: z
        .string()
        .trim()
        .transform((t) => t.replace(/^#/, ''))
        .pipe(
          z
            .string()
            .max(32, 'Topic is at most 32 characters')
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Topic is lowercase letters and digits joined by hyphens')
        ),
    }),
  }),
])

function parseChannelForm(formData: FormData) {
  const type = formData.get('type')
  const config =
    type === 'peskybird'
      ? { appToken: formData.get('appToken'), topic: formData.get('topic') }
      : { botToken: formData.get('botToken'), chatId: formData.get('chatId') }
  return ChannelFormSchema.safeParse({ type, name: formData.get('name'), config })
}

export async function createChannelAction(
  _prev: ChannelFormResult | null,
  formData: FormData
): Promise<ChannelFormResult> {
  const result = parseChannelForm(formData)
  if (!result.success) return { error: result.error.issues[0]?.message ?? 'Invalid values' }
  const { name, type, config } = result.data
  await createChannel({ name, type, config })
  revalidatePath('/settings')
  return { success: true }
}

export async function updateChannelAction(
  channelId: string,
  _prev: ChannelFormResult | null,
  formData: FormData
): Promise<ChannelFormResult> {
  const result = parseChannelForm(formData)
  if (!result.success) return { error: result.error.issues[0]?.message ?? 'Invalid values' }
  const { name, config } = result.data
  try {
    await updateChannel(channelId, { name, config })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Update failed' }
  }
  revalidatePath('/settings')
  return { success: true }
}

export async function deleteChannelAction(channelId: string): Promise<void> {
  await deleteChannel(channelId)
  revalidatePath('/settings')
}

// ---------- alert rules ----------

const CreateRuleSchema = z.object({
  sensorId: z.string().min(1).max(64),
  name: z.string().trim().min(1, 'Name is required').max(128),
  definition: RuleDefinitionSchema,
  channelIds: z.array(z.string().uuid()).max(20),
})

export async function createRuleAction(
  input: unknown
): Promise<{ id?: string; error?: string }> {
  const result = CreateRuleSchema.safeParse(input)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid alert rule' }
  }
  try {
    const id = await createRule(result.data)
    revalidatePath(`/sensors/${result.data.sensorId}`)
    return { id }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create alert' }
  }
}

const UpdateRuleSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(128),
  definition: RuleDefinitionSchema,
  channelIds: z.array(z.string().uuid()).max(20),
})

export async function updateRuleAction(
  ruleId: string,
  input: unknown
): Promise<{ id?: string; error?: string }> {
  const result = UpdateRuleSchema.safeParse(input)
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Invalid alert rule' }
  }
  try {
    const rule = await getRule(ruleId)
    if (!rule) return { error: 'Alert rule not found' }
    await updateRule(ruleId, result.data)
    revalidatePath(`/sensors/${rule.sensorId}`)
    revalidatePath('/alerts')
    return { id: ruleId }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update alert' }
  }
}

export async function setRuleEnabledAction(ruleId: string, enabled: boolean): Promise<void> {
  const rule = await getRule(ruleId)
  await setRuleEnabled(ruleId, enabled)
  revalidatePath('/alerts')
  if (rule) revalidatePath(`/sensors/${rule.sensorId}`)
}

export async function deleteRuleAction(ruleId: string): Promise<void> {
  const rule = await getRule(ruleId)
  await deleteRule(ruleId)
  revalidatePath('/alerts')
  if (rule) revalidatePath(`/sensors/${rule.sensorId}`)
}

export async function testChannelAction(
  channelId: string
): Promise<{ ok: boolean; error?: string }> {
  const channel = await getChannel(channelId)
  if (!channel) return { ok: false, error: 'Channel not found' }
  try {
    await sendToChannel(channel, {
      title: 'Sensify',
      text: `Test message from Sensify — channel "${channel.name}" is working.`,
    })
    revalidatePath('/settings')
    return { ok: true }
  } catch (err) {
    revalidatePath('/settings')
    return { ok: false, error: err instanceof Error ? err.message : 'Send failed' }
  }
}
