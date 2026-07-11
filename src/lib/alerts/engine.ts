// Live alert engine. Drives the pure machine core (machine.ts) from two entry
// points sharing one code path:
//   - evaluateReading(): called from the shared ingest path after a reading is
//     inserted (push ingest runs in the web process, pull in the poller)
//   - sweepOpenRules(): periodic tick (poller) that re-evaluates rules with an
//     open phase so dwell expiry and cooldowns advance between readings
// State is persisted per rule and written only on phase transitions.
import { getDb } from '../db'
import {
  listEnabledRulesForSensor,
  listRulesWithOpenState,
  getRuleState,
  saveRuleState,
  openEvent,
  closeEvent,
  updateEventStats,
  getEvent,
  getChannel,
  recordRuleError,
  type AlertRule,
} from './repo'
import { sendToChannel } from './channels'
import {
  computeSignal,
  stepMachine,
  initStats,
  accumulateStats,
  type MachineState,
  type SignalPoint,
  type Transition,
} from './machine'
import type { EventStats, RuleDefinition } from './schemas'

const RULE_CACHE_TTL_MS = 15_000

const ruleCache = new Map<string, { rules: AlertRule[]; loadedAt: number }>()

function rulesForSensor(sensorId: string): AlertRule[] {
  const cached = ruleCache.get(sensorId)
  if (cached && Date.now() - cached.loadedAt < RULE_CACHE_TTL_MS) return cached.rules
  const rules = listEnabledRulesForSensor(sensorId)
  ruleCache.set(sensorId, { rules, loadedAt: Date.now() })
  return rules
}

/** Test hook / immediate reload after rule edits in the same process. */
export function clearRuleCache(): void {
  ruleCache.clear()
}

// ---------- signal ----------

function fetchSignalPoints(
  sensorId: string,
  metric: string,
  windowS: number,
  atMs: number
): SignalPoint[] {
  const db = getDb()
  const atIso = new Date(atMs).toISOString()
  const startIso = new Date(atMs - Math.max(windowS, 0) * 1000).toISOString()
  const rows = db
    .prepare(
      `SELECT ts, value FROM readings
       WHERE sensor_id = ? AND metric = ? AND ts >= ? AND ts <= ? ORDER BY ts`
    )
    .all(sensorId, metric, startIso, atIso) as { ts: string; value: number }[]
  // One sample from before the window: its value is in effect at window start
  const prior = db
    .prepare(
      `SELECT ts, value FROM readings
       WHERE sensor_id = ? AND metric = ? AND ts < ? ORDER BY ts DESC LIMIT 1`
    )
    .get(sensorId, metric, startIso) as { ts: string; value: number } | undefined
  const points = rows.map((r) => ({ tsMs: Date.parse(r.ts), value: r.value }))
  if (prior) points.unshift({ tsMs: Date.parse(prior.ts), value: prior.value })
  return points
}

function statsBetween(
  sensorId: string,
  metric: string,
  fromMs: number,
  toMs: number
): EventStats | null {
  const rows = getDb()
    .prepare(
      `SELECT value FROM readings
       WHERE sensor_id = ? AND metric = ? AND ts >= ? AND ts <= ? ORDER BY ts`
    )
    .all(sensorId, metric, new Date(fromMs).toISOString(), new Date(toMs).toISOString()) as {
    value: number
  }[]
  if (rows.length === 0) return null
  let stats = initStats(rows[0]!.value)
  for (const row of rows.slice(1)) stats = accumulateStats(stats, row.value)
  return stats
}

// ---------- evaluation ----------

interface EvalOutcome {
  transitions: Transition[]
  eventId: string | null
}

/** Read state → step machine → persist, atomically (BEGIN IMMEDIATE), so the
 *  web and poller processes can never both commit the same transition. */
function evaluateRuleTx(rule: AlertRule, def: RuleDefinition, atMs: number, newValue?: number): EvalOutcome {
  const db = getDb()
  const tx = db.transaction((): EvalOutcome => {
    const persisted = getRuleState(rule.id)
    let state: MachineState
    let eventId: string | null = null

    if (!persisted || persisted.ruleUpdatedAt !== rule.updatedAt) {
      // New rule, or the definition changed: start clean. An event left open
      // by the old definition is closed quietly (no end notification).
      if (persisted?.eventId) {
        const orphan = getEvent(persisted.eventId)
        if (orphan && !orphan.endedAt)
          closeEvent(orphan.id, new Date(atMs).toISOString(), orphan.stats)
      }
      state = { phase: 'idle', phaseSinceMs: atMs }
    } else {
      state = { phase: persisted.phase, phaseSinceMs: Date.parse(persisted.phaseSince) }
      eventId = persisted.eventId
    }

    const points = fetchSignalPoints(rule.sensorId, def.trigger.metric, def.trigger.signal.windowS, atMs)
    const signal = computeSignal(points, def.trigger.signal.agg, def.trigger.signal.windowS, atMs)
    const { state: next, transitions } = stepMachine(def, state, signal, atMs)

    for (const t of transitions) {
      if (t.type === 'start') {
        const stats =
          statsBetween(rule.sensorId, def.trigger.metric, t.atMs, atMs) ??
          initStats(newValue ?? signal ?? 0)
        eventId = openEvent(rule.id, new Date(t.atMs).toISOString(), stats)
      } else if (eventId) {
        const event = getEvent(eventId)
        closeEvent(eventId, new Date(t.atMs).toISOString(), event?.stats ?? null)
        eventId = null
      }
    }

    // Accumulate the raw reading into the open event's stats
    if (eventId && newValue !== undefined && transitions.length === 0) {
      const event = getEvent(eventId)
      if (event) updateEventStats(eventId, accumulateStats(event.stats ?? initStats(newValue), newValue))
    }

    const changed =
      !persisted ||
      persisted.phase !== next.phase ||
      Date.parse(persisted.phaseSince) !== next.phaseSinceMs ||
      persisted.eventId !== eventId ||
      persisted.ruleUpdatedAt !== rule.updatedAt
    if (changed) {
      saveRuleState({
        ruleId: rule.id,
        phase: next.phase,
        phaseSince: new Date(next.phaseSinceMs).toISOString(),
        eventId,
        ruleUpdatedAt: rule.updatedAt,
      })
    }
    return { transitions, eventId }
  })
  return tx.immediate()
}

function evaluateRule(rule: AlertRule, atMs: number, newValue?: number): void {
  const def = rule.definition
  if (!def) {
    if (rule.lastError !== rule.definitionError) recordRuleError(rule.id, rule.definitionError)
    return
  }
  try {
    const { transitions, eventId } = evaluateRuleTx(rule, def, atMs, newValue)
    if (rule.lastError) recordRuleError(rule.id, null)
    for (const t of transitions) {
      void notifyTransition(rule, def, t, eventId).catch((err) => {
        recordRuleError(rule.id, `notification failed: ${err instanceof Error ? err.message : err}`)
      })
    }
  } catch (err) {
    recordRuleError(rule.id, err instanceof Error ? err.message : String(err))
  }
}

/** Ingest hook — one code path for push and pull readings. Never throws. */
export function evaluateReading(sensorId: string, metric: string, value: number, tsIso: string): void {
  try {
    const atMs = Date.parse(tsIso)
    for (const rule of rulesForSensor(sensorId)) {
      if (rule.definition && rule.definition.trigger.metric !== metric) continue
      evaluateRule(rule, atMs, value)
    }
  } catch (err) {
    console.error('[alerts] evaluateReading failed:', err)
  }
}

/** Periodic tick: advance dwell/cooldown for rules whose phase is open even
 *  when no new readings arrive. Runs in the poller process. */
export function sweepOpenRules(): void {
  try {
    const now = Date.now()
    for (const rule of listRulesWithOpenState()) evaluateRule(rule, now)
  } catch (err) {
    console.error('[alerts] sweep failed:', err)
  }
}

// ---------- notifications ----------

function humanizeDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m)
}

const DEFAULT_START = '▶ {metric} is {value} on {sensor}'
const DEFAULT_END = '✅ Finished after {duration} — {metric} peaked at {max} on {sensor}'

async function notifyTransition(
  rule: AlertRule,
  def: RuleDefinition,
  transition: Transition,
  eventId: string | null
): Promise<void> {
  const sensor = getDb().prepare('SELECT name FROM sensors WHERE id = ?').get(rule.sensorId) as
    | { name: string }
    | undefined
  // Start transitions have an open event; end transitions just closed theirs
  const event = eventId ? getEvent(eventId) : lastClosedEvent(rule.id)
  const stats = event?.stats ?? null

  const vars: Record<string, string> = {
    rule: rule.name,
    sensor: sensor?.name ?? rule.sensorId,
    metric: def.trigger.metric,
    value: stats ? fmt(stats.last) : '?',
    min: stats ? fmt(stats.min) : '?',
    max: stats ? fmt(stats.max) : '?',
    avg: stats ? fmt(stats.sum / stats.count) : '?',
    duration: humanizeDuration(Date.now() - transition.atMs),
    started_at: new Date(transition.atMs).toLocaleString(),
    ended_at: new Date().toLocaleString(),
  }
  if (transition.type === 'end' && event?.endedAt) {
    vars.duration = humanizeDuration(Date.parse(event.endedAt) - Date.parse(event.startedAt))
    vars.started_at = new Date(event.startedAt).toLocaleString()
    vars.ended_at = new Date(event.endedAt).toLocaleString()
  }

  const template =
    transition.type === 'start' ? (def.notify.onStart ?? DEFAULT_START) : (def.notify.onEnd ?? DEFAULT_END)
  const message = renderTemplate(template, vars)
  await deliver(rule, transition.type, message)
}

/** Fan a rendered message out to the rule's channels. Failures are recorded
 *  per channel; an aggregate error propagates to the rule's last_error. */
async function deliver(rule: AlertRule, kind: 'start' | 'end', text: string): Promise<void> {
  console.log(`[alert:${kind}] ${rule.name}: ${text}`)
  const failures: string[] = []
  for (const channelId of rule.channelIds) {
    const channel = await getChannel(channelId)
    if (!channel) continue
    try {
      await sendToChannel(channel, { title: rule.name, text })
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (failures.length > 0) throw new Error(failures.join('; '))
}

function lastClosedEvent(ruleId: string) {
  const row = getDb()
    .prepare(
      'SELECT id FROM alert_events WHERE rule_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT 1'
    )
    .get(ruleId) as { id: string } | undefined
  return row ? getEvent(row.id) : null
}

