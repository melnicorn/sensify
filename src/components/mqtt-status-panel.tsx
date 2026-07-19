'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/react'
import { Radio, Play, Pause, Pencil, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { setMqttEnabledAction, setMqttConfigIntervalAction } from '@/app/actions'
import type { SensorMeta } from '@/lib/types'

export function MqttStatusPanel({ meta }: { meta: SensorMeta }) {
  const [pending, startTransition] = useTransition()
  const [savingConfig, startConfigSave] = useTransition()
  const [intervalText, setIntervalText] = useState(
    meta.desiredInterval != null ? String(meta.desiredInterval) : ''
  )
  const [configResult, setConfigResult] = useState<{ error?: string; success?: boolean } | null>(
    null
  )
  const m = meta.mqtt!

  function toggle() {
    startTransition(async () => {
      await setMqttEnabledAction(meta.id, !m.enabled)
    })
  }

  function saveInterval() {
    const raw = intervalText.trim()
    const value = raw === '' ? null : parseInt(raw, 10)
    if (value !== null && Number.isNaN(value)) {
      setConfigResult({ error: 'Enter a whole number of seconds, or leave blank to clear' })
      return
    }
    setConfigResult(null)
    startConfigSave(async () => {
      setConfigResult(await setMqttConfigIntervalAction(meta.id, value))
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">MQTT subscription</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label={m.enabled ? 'Pause ingest' : 'Resume ingest'}
            isDisabled={pending}
            onPress={toggle}
          >
            {m.enabled ? <Pause size={14} /> : <Play size={14} />}
          </Button>
          <Link
            href={`/devices/${meta.id}/edit`}
            aria-label="Edit sensor"
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil size={14} />
          </Link>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Topic</dt>
          <dd className="font-mono text-xs text-foreground break-all">{m.topic}</dd>
        </div>
        {m.availabilityTopic && (
          <div>
            <dt className="text-xs text-muted-foreground">Availability topic</dt>
            <dd className="font-mono text-xs text-foreground break-all">{m.availabilityTopic}</dd>
          </div>
        )}
        <div className="flex gap-6">
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="text-foreground">{m.enabled ? 'Active' : 'Paused'}</dd>
          </div>
          {m.availabilityTopic && (
            <div>
              <dt className="text-xs text-muted-foreground">Device</dt>
              <dd
                className={
                  m.online === true
                    ? 'text-green-600 dark:text-green-400'
                    : m.online === false
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }
                title={m.onlineAt ? `since ${new Date(m.onlineAt).toLocaleString()}` : undefined}
              >
                {m.online === true ? 'Online' : m.online === false ? 'Offline' : 'Unknown'}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-muted-foreground">QoS</dt>
            <dd className="text-foreground">{m.qos}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Fields</dt>
            <dd className="text-foreground">{m.fields.length}</dd>
          </div>
        </div>
        {m.lastSuccess && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-green-600 dark:text-green-400 shrink-0" />
            <span className="text-xs text-muted-foreground">
              Last message: {new Date(m.lastSuccess).toLocaleString()}
            </span>
          </div>
        )}
        {m.lastError && (
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">
              {m.lastError}
              {m.consecutiveFailures > 0 && ` (${m.consecutiveFailures} consecutive)`}
            </span>
          </div>
        )}
      </dl>

      {m.configTopic && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <label htmlFor="mqtt-interval" className="text-xs text-muted-foreground">
            Reporting interval — published retained to{' '}
            <code className="font-mono">{m.configTopic}</code>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="mqtt-interval"
              type="number"
              min={5}
              max={86400}
              value={intervalText}
              onChange={(e) => setIntervalText(e.target.value)}
              placeholder="seconds"
              className="w-28 rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button size="sm" variant="ghost" onPress={saveInterval} isDisabled={savingConfig}>
              {savingConfig ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
          {configResult?.error && (
            <p className="text-xs text-destructive">{configResult.error}</p>
          )}
          {configResult?.success && (
            <p className="text-xs text-green-600 dark:text-green-400">
              Published. Devices subscribed to that topic get it immediately.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {m.fields.map((f) => (
          <span
            key={f.metric}
            className="text-xs px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground font-mono"
            title={f.path}
          >
            {f.metric}
            {f.unit ? ` (${f.unit})` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
