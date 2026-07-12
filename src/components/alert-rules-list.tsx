'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { Pause, Pencil, Play, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@heroui/react'
import { setRuleEnabledAction, deleteRuleAction } from '@/app/alerts-actions'
import type { Phase } from '@/lib/alerts/schemas'

export interface RuleView {
  id: string
  name: string
  enabled: boolean
  sensorId: string
  sensorName: string
  summary: string // human sentence from describeRule, or the definition error
  hasError: boolean
  phase: Phase
  channelNames: string[]
  lastEvent: { startedAt: string; endedAt: string | null; max: number | null } | null
}

const PHASE_STYLE: Record<Phase, string> = {
  idle: 'text-muted-foreground border-border',
  pending: 'text-amber-600 dark:text-amber-400 border-amber-600/40',
  active: 'text-green-600 dark:text-green-400 border-green-600/40',
  clearing: 'text-amber-600 dark:text-amber-400 border-amber-600/40',
  cooldown: 'text-muted-foreground border-border',
}

function fmtDuration(fromIso: string, toIso: string): string {
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function RuleRow({
  rule,
  showSensor,
  onEdit,
}: {
  rule: RuleView
  showSensor: boolean
  onEdit?: (ruleId: string) => void
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <div className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          {rule.name}
          <span
            className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${PHASE_STYLE[rule.phase]}`}
          >
            {rule.enabled ? rule.phase : 'paused'}
          </span>
        </p>
        {showSensor && (
          <p className="text-xs text-muted-foreground">
            <Link href={`/sensors/${rule.sensorId}`} className="underline hover:no-underline">
              {rule.sensorName}
            </Link>
          </p>
        )}
        {rule.hasError ? (
          <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle size={12} className="shrink-0" />
            <span className="truncate">{rule.summary}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground truncate">{rule.summary}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {rule.channelNames.length > 0 ? `→ ${rule.channelNames.join(', ')}` : 'no channels (logs only)'}
          {rule.lastEvent &&
            ` · last event ${new Date(rule.lastEvent.startedAt).toLocaleString()}${
              rule.lastEvent.endedAt
                ? ` (${fmtDuration(rule.lastEvent.startedAt, rule.lastEvent.endedAt)})`
                : ' (ongoing)'
            }`}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!rule.hasError &&
          (onEdit ? (
            <Button
              variant="ghost"
              size="sm"
              isDisabled={isPending}
              onPress={() => onEdit(rule.id)}
              aria-label="Edit alert"
            >
              <Pencil size={13} />
            </Button>
          ) : (
            // Editing happens on the sensor page, where the wizard has context
            <Link
              href={`/sensors/${rule.sensorId}`}
              aria-label="Edit alert on the sensor page"
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Pencil size={13} />
            </Link>
          ))}
        <Button
          variant="ghost"
          size="sm"
          isDisabled={isPending}
          onPress={() => startTransition(() => setRuleEnabledAction(rule.id, !rule.enabled))}
          aria-label={rule.enabled ? 'Pause alert' : 'Resume alert'}
        >
          {rule.enabled ? <Pause size={13} /> : <Play size={13} />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10"
          isDisabled={isPending}
          onPress={() => startTransition(() => deleteRuleAction(rule.id))}
          aria-label="Delete alert"
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </div>
  )
}

export function AlertRulesList({
  rules,
  showSensor = false,
  onEdit,
}: {
  rules: RuleView[]
  showSensor?: boolean
  onEdit?: (ruleId: string) => void
}) {
  if (rules.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No alerts yet. Drag across a chart to select an example event, then hit “Create alert”.
      </p>
    )
  }
  return (
    <div className="divide-y divide-border">
      {rules.map((r) => (
        <RuleRow key={r.id} rule={r} showSensor={showSensor} onEdit={onEdit} />
      ))}
    </div>
  )
}
