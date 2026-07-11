'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  createChannel,
  updateChannel,
  deleteChannel,
  getChannel,
} from '@/lib/alerts/repo'
import { sendToChannel } from '@/lib/alerts/channels'

export interface ChannelFormResult {
  error?: string
  success?: boolean
}

const TelegramFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(64),
  botToken: z.string().trim().min(10, 'Bot token looks too short').max(200),
  chatId: z.string().trim().min(1, 'Chat ID is required').max(64),
})

function parseTelegramForm(formData: FormData) {
  return TelegramFormSchema.safeParse({
    name: formData.get('name'),
    botToken: formData.get('botToken'),
    chatId: formData.get('chatId'),
  })
}

export async function createChannelAction(
  _prev: ChannelFormResult | null,
  formData: FormData
): Promise<ChannelFormResult> {
  const result = parseTelegramForm(formData)
  if (!result.success) return { error: result.error.issues[0]?.message ?? 'Invalid values' }
  const { name, botToken, chatId } = result.data
  await createChannel({ name, type: 'telegram', config: { botToken, chatId } })
  revalidatePath('/settings')
  return { success: true }
}

export async function updateChannelAction(
  channelId: string,
  _prev: ChannelFormResult | null,
  formData: FormData
): Promise<ChannelFormResult> {
  const result = parseTelegramForm(formData)
  if (!result.success) return { error: result.error.issues[0]?.message ?? 'Invalid values' }
  const { name, botToken, chatId } = result.data
  try {
    await updateChannel(channelId, { name, config: { botToken, chatId } })
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
