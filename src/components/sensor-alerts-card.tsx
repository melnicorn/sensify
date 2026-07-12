'use client'

// The sensor page's Alerts card: rule list plus the wizard in edit mode.
import { useState } from 'react'
import { AlertRulesList, type RuleView } from './alert-rules-list'
import { AlertWizard, type EditableRule } from './alert-wizard'
import type { Channel } from '@/lib/alerts/repo'
import type { SensorMeta, AppConfig } from '@/lib/types'

interface Props {
  meta: SensorMeta
  config: AppConfig
  channels: Channel[]
  ruleViews: RuleView[]
  editableRules: EditableRule[] // rules with a parseable definition
}

export function SensorAlertsCard({ meta, config, channels, ruleViews, editableRules }: Props) {
  const [editing, setEditing] = useState<EditableRule | null>(null)

  if (ruleViews.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground mb-1">Alerts</h2>
      <AlertRulesList
        rules={ruleViews}
        onEdit={(ruleId) => setEditing(editableRules.find((r) => r.id === ruleId) ?? null)}
      />
      {editing && (
        <AlertWizard
          meta={meta}
          config={config}
          channels={channels}
          readings={[]}
          selection={null}
          editRule={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
