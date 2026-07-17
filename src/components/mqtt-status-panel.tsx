'use client'

import { useTransition } from 'react'
import { Button } from '@heroui/react'
import { Radio, Play, Pause, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { setMqttEnabledAction } from '@/app/actions'
import type { SensorMeta } from '@/lib/types'

export function MqttStatusPanel({ meta }: { meta: SensorMeta }) {
  const [pending, startTransition] = useTransition()
  const m = meta.mqtt!

  function toggle() {
    startTransition(async () => {
      await setMqttEnabledAction(meta.id, !m.enabled)
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">MQTT subscription</h2>
        </div>
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
      </div>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Topic</dt>
          <dd className="font-mono text-xs text-foreground break-all">{m.topic}</dd>
        </div>
        <div className="flex gap-6">
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="text-foreground">{m.enabled ? 'Active' : 'Paused'}</dd>
          </div>
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
