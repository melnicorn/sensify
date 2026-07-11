// Server-side assembly of rule/event view models for the UI.
import { getDb } from '../db'
import { getRuleState, listEventsForRule, listChannels, type AlertRule } from './repo'
import { describeRule } from './describe'
import type { RuleView } from '@/components/alert-rules-list'

export async function buildRuleViews(rules: AlertRule[]): Promise<RuleView[]> {
  const channels = await listChannels()
  const channelName = new Map(channels.map((c) => [c.id, c.name]))
  const db = getDb()

  return Promise.all(
    rules.map(async (rule) => {
      const state = getRuleState(rule.id)
      const [lastEvent] = await listEventsForRule(rule.id, 1)
      const sensor = db.prepare('SELECT name FROM sensors WHERE id = ?').get(rule.sensorId) as
        | { name: string }
        | undefined
      return {
        id: rule.id,
        name: rule.name,
        enabled: rule.enabled,
        sensorId: rule.sensorId,
        sensorName: sensor?.name ?? rule.sensorId,
        summary: rule.definition
          ? describeRule(rule.definition)
          : (rule.definitionError ?? 'invalid definition'),
        hasError: !rule.definition || !!rule.lastError,
        phase: state?.phase ?? 'idle',
        channelNames: rule.channelIds
          .map((id) => channelName.get(id))
          .filter((n): n is string => !!n),
        lastEvent: lastEvent
          ? {
              startedAt: lastEvent.startedAt,
              endedAt: lastEvent.endedAt,
              max: lastEvent.stats?.max ?? null,
            }
          : null,
      }
    })
  )
}
