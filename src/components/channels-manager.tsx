'use client'

import { useState, useTransition, useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Plus, Send, Trash2, Pencil, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@heroui/react'
import {
  createChannelAction,
  updateChannelAction,
  deleteChannelAction,
  testChannelAction,
  type ChannelFormResult,
} from '@/app/alerts-actions'
import type { Channel } from '@/lib/alerts/repo'

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" isDisabled={pending} size="sm">
      {pending ? 'Saving…' : label}
    </Button>
  )
}

function ChannelForm({
  channel,
  action,
  onDone,
}: {
  channel?: Channel
  action: (prev: ChannelFormResult | null, formData: FormData) => Promise<ChannelFormResult>
  onDone: () => void
}) {
  const [state, formAction] = useActionState(
    async (prev: ChannelFormResult | null, formData: FormData) => {
      const result = await action(prev, formData)
      if (result.success) onDone()
      return result
    },
    null
  )

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">Name</label>
        <input
          name="name"
          required
          maxLength={64}
          defaultValue={channel?.name}
          placeholder="Family Telegram"
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">Bot token</label>
        <input
          name="botToken"
          required
          type="password"
          autoComplete="off"
          maxLength={200}
          defaultValue={channel?.config.botToken}
          placeholder="123456789:AA…"
          className={`${inputClass} font-mono`}
        />
        <p className="text-xs text-muted-foreground">
          From <span className="font-mono">@BotFather</span> on Telegram.
        </p>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-foreground">Chat ID</label>
        <input
          name="chatId"
          required
          maxLength={64}
          defaultValue={channel?.config.chatId}
          placeholder="-1001234567890"
          className={`${inputClass} font-mono`}
        />
        <p className="text-xs text-muted-foreground">
          The user, group, or channel the bot should message.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton label={channel ? 'Save channel' : 'Add channel'} />
        <Button variant="ghost" size="sm" onPress={onDone}>
          Cancel
        </Button>
        {state?.error && <span className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
  )
}

function ChannelRow({ channel }: { channel: Channel }) {
  const [editing, setEditing] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  if (editing) {
    return (
      <div className="py-3">
        <ChannelForm
          channel={channel}
          action={updateChannelAction.bind(null, channel.id)}
          onDone={() => setEditing(false)}
        />
      </div>
    )
  }

  const status = testResult ?? (channel.lastError ? { ok: false, error: channel.lastError } : null)

  return (
    <div className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground flex items-center gap-2">
          {channel.name}
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {channel.type}
          </span>
        </p>
        <p className="text-xs text-muted-foreground font-mono">chat {channel.config.chatId}</p>
        {status &&
          (status.ok ? (
            <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 size={12} /> Test message delivered
            </p>
          ) : (
            <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle size={12} className="shrink-0" />
              <span className="truncate">{status.error}</span>
            </p>
          ))}
        {!status && channel.lastOkAt && (
          <p className="text-xs text-muted-foreground">
            Last delivered {new Date(channel.lastOkAt).toLocaleString()}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          isDisabled={isPending}
          onPress={() =>
            startTransition(async () => setTestResult(await testChannelAction(channel.id)))
          }
        >
          <Send size={13} className="mr-1" />
          {isPending ? 'Sending…' : 'Test'}
        </Button>
        <Button variant="ghost" size="sm" onPress={() => setEditing(true)} aria-label="Edit channel">
          <Pencil size={13} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          onPress={() => startTransition(() => deleteChannelAction(channel.id))}
          aria-label="Delete channel"
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </div>
  )
}

export function ChannelsManager({ channels }: { channels: Channel[] }) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Notification channels</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Where alert rules deliver their messages.
          </p>
        </div>
        {!adding && (
          <Button variant="ghost" size="sm" onPress={() => setAdding(true)}>
            <Plus size={13} className="mr-1" />
            Add channel
          </Button>
        )}
      </div>

      {adding && (
        <div className="pt-3">
          <ChannelForm action={createChannelAction} onDone={() => setAdding(false)} />
        </div>
      )}

      {channels.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground pt-3">
          No channels yet. Add a Telegram bot to receive alerts.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {channels.map((c) => (
            <ChannelRow key={c.id} channel={c} />
          ))}
        </div>
      )}
    </div>
  )
}
