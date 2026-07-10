'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@heroui/react'
import { DownloadCloud, Pencil, Play, Pause, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { setPullEnabledAction } from '@/app/actions'
import type { SensorMeta } from '@/lib/types'

export function PullStatusPanel({ meta }: { meta: SensorMeta }) {
  const [pending, startTransition] = useTransition()
  const pull = meta.pull!

  function toggle() {
    startTransition(async () => {
      await setPullEnabledAction(meta.id, !pull.enabled)
    })
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DownloadCloud size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">Polling</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label={pull.enabled ? 'Pause polling' : 'Resume polling'}
            isDisabled={pending}
            onPress={toggle}
          >
            {pull.enabled ? <Pause size={14} /> : <Play size={14} />}
          </Button>
          <Link
            href={`/devices/${meta.id}/edit`}
            aria-label="Edit device"
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil size={14} />
          </Link>
        </div>
      </div>

      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Endpoint</dt>
          <dd className="font-mono text-xs text-foreground break-all">{pull.url}</dd>
        </div>
        <div className="flex gap-6">
          <div>
            <dt className="text-xs text-muted-foreground">Interval</dt>
            <dd className="text-foreground">{pull.pollInterval}s</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="text-foreground">{pull.enabled ? 'Active' : 'Paused'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Fields</dt>
            <dd className="text-foreground">{pull.fields.length}</dd>
          </div>
        </div>
        {pull.lastSuccess && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-green-600 dark:text-green-400 shrink-0" />
            <span className="text-xs text-muted-foreground">
              Last successful poll: {new Date(pull.lastSuccess).toLocaleString()}
            </span>
          </div>
        )}
        {pull.lastError && (
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground">
              {pull.lastError}
              {pull.consecutiveFailures > 0 && ` (${pull.consecutiveFailures} consecutive failures)`}
            </span>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-1.5">
        {pull.fields.map((f) => (
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
