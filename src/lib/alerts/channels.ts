// Notification channel drivers. Each driver knows how to deliver a message
// for one channel type; its config shape is validated by the matching schema
// in schemas.ts (CHANNEL_CONFIG_SCHEMAS). Adding a channel type = one driver
// entry here + one config schema + a form in the admin UI.
import type { ChannelType } from './schemas'
import { recordChannelResult, type Channel } from './repo'

export interface ChannelMessage {
  title: string
  text: string
}

interface ChannelDriver {
  send(config: Record<string, string>, message: ChannelMessage): Promise<void>
}

const SEND_TIMEOUT_MS = 10_000

const telegram: ChannelDriver = {
  async send(config, message) {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      body: JSON.stringify({
        chat_id: config.chatId,
        text: `<b>${esc(message.title)}</b>\n${esc(message.text)}`,
        parse_mode: 'HTML',
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Telegram HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
  },
}

const DRIVERS: Record<ChannelType, ChannelDriver> = { telegram }

/** Deliver to one channel, recording the outcome for the admin UI. Throws on
 *  failure so callers can aggregate. */
export async function sendToChannel(channel: Channel, message: ChannelMessage): Promise<void> {
  try {
    await DRIVERS[channel.type].send(channel.config, message)
    recordChannelResult(channel.id, true)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    recordChannelResult(channel.id, false, detail)
    throw new Error(`${channel.name}: ${detail}`)
  }
}
