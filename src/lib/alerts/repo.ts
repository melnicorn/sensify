import { getDb } from '../db'
import {
  parseDefinition,
  CHANNEL_CONFIG_SCHEMAS,
  type RuleDefinition,
  type Phase,
  type EventStats,
  type ChannelType,
} from './schemas'

// ---------- channels ----------

export interface Channel {
  id: string
  name: string
  type: ChannelType
  config: Record<string, string>
  lastOkAt: string | null
  lastError: string | null
  createdAt: string
}

interface ChannelRow {
  id: string
  name: string
  type: string
  config: string
  last_ok_at: string | null
  last_error: string | null
  created_at: string
}

function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ChannelType,
    config: JSON.parse(row.config) as Record<string, string>,
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  }
}

export async function listChannels(): Promise<Channel[]> {
  const rows = getDb()
    .prepare('SELECT * FROM channels ORDER BY name COLLATE NOCASE')
    .all() as ChannelRow[]
  return rows.map(rowToChannel)
}

export async function getChannel(id: string): Promise<Channel | null> {
  const row = getDb().prepare('SELECT * FROM channels WHERE id = ?').get(id) as
    | ChannelRow
    | undefined
  return row ? rowToChannel(row) : null
}

export async function createChannel(input: {
  name: string
  type: ChannelType
  config: Record<string, string>
}): Promise<string> {
  CHANNEL_CONFIG_SCHEMAS[input.type].parse(input.config)
  const id = crypto.randomUUID()
  getDb()
    .prepare('INSERT INTO channels (id, name, type, config, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, input.name, input.type, JSON.stringify(input.config), new Date().toISOString())
  return id
}

export async function updateChannel(
  id: string,
  input: { name: string; config: Record<string, string> }
): Promise<void> {
  const existing = await getChannel(id)
  if (!existing) throw new Error(`Channel ${id} not found`)
  CHANNEL_CONFIG_SCHEMAS[existing.type].parse(input.config)
  getDb()
    .prepare('UPDATE channels SET name = ?, config = ? WHERE id = ?')
    .run(input.name, JSON.stringify(input.config), id)
}

export async function deleteChannel(id: string): Promise<void> {
  getDb().prepare('DELETE FROM channels WHERE id = ?').run(id)
}

/** Record the outcome of the most recent send attempt, for the admin UI. */
export function recordChannelResult(id: string, ok: boolean, error?: string): void {
  if (ok) {
    getDb()
      .prepare('UPDATE channels SET last_ok_at = ?, last_error = NULL WHERE id = ?')
      .run(new Date().toISOString(), id)
  } else {
    getDb()
      .prepare('UPDATE channels SET last_error = ? WHERE id = ?')
      .run(error ?? 'unknown error', id)
  }
}

// ---------- alert rules ----------

export interface AlertRule {
  id: string
  sensorId: string
  name: string
  enabled: boolean
  definition: RuleDefinition | null // null when the stored JSON fails validation
  definitionError: string | null
  channelIds: string[]
  lastError: string | null
  createdAt: string
  updatedAt: string
}

interface RuleRow {
  id: string
  sensor_id: string
  name: string
  enabled: number
  definition: string
  last_error: string | null
  created_at: string
  updated_at: string
}

function rowToRule(row: RuleRow): AlertRule {
  const { def, error } = parseDefinition(row.definition)
  const channelIds = (
    getDb()
      .prepare('SELECT channel_id FROM alert_rule_channels WHERE rule_id = ?')
      .all(row.id) as { channel_id: string }[]
  ).map((r) => r.channel_id)
  return {
    id: row.id,
    sensorId: row.sensor_id,
    name: row.name,
    enabled: row.enabled === 1,
    definition: def,
    definitionError: error,
    channelIds,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listRules(): Promise<AlertRule[]> {
  const rows = getDb()
    .prepare('SELECT * FROM alert_rules ORDER BY created_at')
    .all() as RuleRow[]
  return rows.map(rowToRule)
}

export async function listRulesForSensor(sensorId: string): Promise<AlertRule[]> {
  const rows = getDb()
    .prepare('SELECT * FROM alert_rules WHERE sensor_id = ? ORDER BY created_at')
    .all(sensorId) as RuleRow[]
  return rows.map(rowToRule)
}

/** Enabled rules for one sensor — the engine's hot path (cached by caller). */
export function listEnabledRulesForSensor(sensorId: string): AlertRule[] {
  const rows = getDb()
    .prepare('SELECT * FROM alert_rules WHERE sensor_id = ? AND enabled = 1')
    .all(sensorId) as RuleRow[]
  return rows.map(rowToRule)
}

/** Enabled rules with an open (active/clearing) state — the sweeper's list. */
export function listRulesWithOpenState(): AlertRule[] {
  const rows = getDb()
    .prepare(
      `SELECT r.* FROM alert_rules r
       JOIN alert_rule_state s ON s.rule_id = r.id
       WHERE r.enabled = 1 AND s.phase IN ('pending', 'active', 'clearing')`
    )
    .all() as RuleRow[]
  return rows.map(rowToRule)
}

export async function getRule(id: string): Promise<AlertRule | null> {
  const row = getDb().prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as
    | RuleRow
    | undefined
  return row ? rowToRule(row) : null
}

export async function createRule(input: {
  sensorId: string
  name: string
  definition: RuleDefinition
  channelIds: string[]
}): Promise<string> {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO alert_rules (id, sensor_id, name, enabled, definition, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    ).run(id, input.sensorId, input.name, JSON.stringify(input.definition), now, now)
    const insert = db.prepare(
      'INSERT INTO alert_rule_channels (rule_id, channel_id) VALUES (?, ?)'
    )
    for (const channelId of input.channelIds) insert.run(id, channelId)
  })
  tx()
  return id
}

/** updated_at doubles as the definition version the engine keys rule state
 *  to, so it must strictly increase even for edits within one millisecond. */
function bumpedUpdatedAt(db: ReturnType<typeof getDb>, id: string): string {
  const row = db.prepare('SELECT updated_at FROM alert_rules WHERE id = ?').get(id) as
    | { updated_at: string }
    | undefined
  const now = new Date().toISOString()
  if (!row || now > row.updated_at) return now
  return new Date(Date.parse(row.updated_at) + 1).toISOString()
}

export async function updateRule(
  id: string,
  input: { name: string; definition: RuleDefinition; channelIds: string[] }
): Promise<void> {
  const db = getDb()
  const tx = db.transaction(() => {
    const now = bumpedUpdatedAt(db, id)
    const result = db
      .prepare('UPDATE alert_rules SET name = ?, definition = ?, updated_at = ? WHERE id = ?')
      .run(input.name, JSON.stringify(input.definition), now, id)
    if (result.changes === 0) throw new Error(`Alert rule ${id} not found`)
    db.prepare('DELETE FROM alert_rule_channels WHERE rule_id = ?').run(id)
    const insert = db.prepare(
      'INSERT INTO alert_rule_channels (rule_id, channel_id) VALUES (?, ?)'
    )
    for (const channelId of input.channelIds) insert.run(id, channelId)
  })
  tx()
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const db = getDb()
  const result = db
    .prepare('UPDATE alert_rules SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, bumpedUpdatedAt(db, id), id)
  if (result.changes === 0) throw new Error(`Alert rule ${id} not found`)
}

export async function deleteRule(id: string): Promise<void> {
  getDb().prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
}

export function recordRuleError(id: string, error: string | null): void {
  getDb().prepare('UPDATE alert_rules SET last_error = ? WHERE id = ?').run(error, id)
}

// ---------- rule runtime state ----------

export interface RuleState {
  ruleId: string
  phase: Phase
  phaseSince: string
  eventId: string | null
  ruleUpdatedAt: string | null // definition version this state belongs to
}

export function getRuleState(ruleId: string): RuleState | null {
  const row = getDb().prepare('SELECT * FROM alert_rule_state WHERE rule_id = ?').get(ruleId) as
    | {
        rule_id: string
        phase: string
        phase_since: string
        event_id: string | null
        rule_updated_at: string | null
      }
    | undefined
  if (!row) return null
  return {
    ruleId: row.rule_id,
    phase: row.phase as Phase,
    phaseSince: row.phase_since,
    eventId: row.event_id,
    ruleUpdatedAt: row.rule_updated_at,
  }
}

export function saveRuleState(state: RuleState): void {
  getDb()
    .prepare(
      `INSERT INTO alert_rule_state (rule_id, phase, phase_since, event_id, rule_updated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(rule_id) DO UPDATE SET
         phase = excluded.phase, phase_since = excluded.phase_since,
         event_id = excluded.event_id, rule_updated_at = excluded.rule_updated_at,
         updated_at = excluded.updated_at`
    )
    .run(
      state.ruleId,
      state.phase,
      state.phaseSince,
      state.eventId,
      state.ruleUpdatedAt,
      new Date().toISOString()
    )
}

// ---------- events ----------

export interface AlertEvent {
  id: string
  ruleId: string
  startedAt: string
  endedAt: string | null
  stats: EventStats | null
}

interface EventRow {
  id: string
  rule_id: string
  started_at: string
  ended_at: string | null
  stats: string | null
}

function rowToEvent(row: EventRow): AlertEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    stats: row.stats ? (JSON.parse(row.stats) as EventStats) : null,
  }
}

export function openEvent(ruleId: string, startedAt: string, stats: EventStats): string {
  const id = crypto.randomUUID()
  getDb()
    .prepare('INSERT INTO alert_events (id, rule_id, started_at, stats) VALUES (?, ?, ?, ?)')
    .run(id, ruleId, startedAt, JSON.stringify(stats))
  return id
}

export function updateEventStats(id: string, stats: EventStats): void {
  getDb().prepare('UPDATE alert_events SET stats = ? WHERE id = ?').run(JSON.stringify(stats), id)
}

export function closeEvent(id: string, endedAt: string, stats: EventStats | null): void {
  getDb()
    .prepare('UPDATE alert_events SET ended_at = ?, stats = ? WHERE id = ?')
    .run(endedAt, stats ? JSON.stringify(stats) : null, id)
}

export function getEvent(id: string): AlertEvent | null {
  const row = getDb().prepare('SELECT * FROM alert_events WHERE id = ?').get(id) as
    | EventRow
    | undefined
  return row ? rowToEvent(row) : null
}

export async function listEventsForRule(ruleId: string, limit = 50): Promise<AlertEvent[]> {
  const rows = getDb()
    .prepare('SELECT * FROM alert_events WHERE rule_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(ruleId, limit) as EventRow[]
  return rows.map(rowToEvent)
}

export interface SensorAlertEvent extends AlertEvent {
  ruleName: string
  metric: string | null // null when the stored definition fails validation
}

/** Event history across all of one sensor's rules, newest first. */
export async function listEventsForSensor(
  sensorId: string,
  limit = 20
): Promise<SensorAlertEvent[]> {
  const rows = getDb()
    .prepare(
      `SELECT e.*, r.name AS rule_name, r.definition FROM alert_events e
       JOIN alert_rules r ON r.id = e.rule_id
       WHERE r.sensor_id = ? ORDER BY e.started_at DESC LIMIT ?`
    )
    .all(sensorId, limit) as (EventRow & { rule_name: string; definition: string })[]
  return rows.map((row) => ({
    ...rowToEvent(row),
    ruleName: row.rule_name,
    metric: parseDefinition(row.definition).def?.trigger.metric ?? null,
  }))
}

// ---------- dashboard summary ----------

/** How long a finished event still counts as "recently completed". */
export const RECENTLY_COMPLETED_MS = 60 * 60 * 1000

export type SensorAlertStatus = 'active' | 'error' | 'completed' | 'paused' | 'inactive'

export interface SensorAlertSummary {
  status: SensorAlertStatus
  /** The rule that determined the status. */
  ruleName: string
  /** Total rules on the sensor, so the card can say "+2 more". */
  ruleCount: number
  /** Event start for 'active', event end for 'completed'. */
  since?: string
}

const STATUS_RANK: Record<SensorAlertStatus, number> = {
  active: 0,
  error: 1,
  completed: 2,
  paused: 3,
  inactive: 4,
}

/**
 * One compact alert status per sensor for the dashboard, in three flat queries
 * rather than per-sensor lookups (the dashboard renders every sensor).
 *
 * Status comes from events rather than the machine phase: `pending` and
 * `clearing` are debounce internals, so a rule in `pending` hasn't fired and
 * shouldn't light up the card. Sensors with no rules are absent from the map.
 */
export async function listSensorAlertSummaries(
  nowMs = Date.now()
): Promise<Map<string, SensorAlertSummary>> {
  const db = getDb()

  const rules = db
    .prepare('SELECT id, sensor_id, name, enabled, last_error FROM alert_rules')
    .all() as {
    id: string
    sensor_id: string
    name: string
    enabled: number
    last_error: string | null
  }[]
  if (rules.length === 0) return new Map()

  const openStartedAt = new Map(
    (
      db
        .prepare('SELECT rule_id, MIN(started_at) AS started_at FROM alert_events WHERE ended_at IS NULL GROUP BY rule_id')
        .all() as { rule_id: string; started_at: string }[]
    ).map((r) => [r.rule_id, r.started_at])
  )
  const lastEndedAt = new Map(
    (
      db
        .prepare('SELECT rule_id, MAX(ended_at) AS ended_at FROM alert_events WHERE ended_at IS NOT NULL GROUP BY rule_id')
        .all() as { rule_id: string; ended_at: string }[]
    ).map((r) => [r.rule_id, r.ended_at])
  )

  const summaries = new Map<string, SensorAlertSummary>()
  for (const rule of rules) {
    const openedAt = openStartedAt.get(rule.id)
    const endedAt = lastEndedAt.get(rule.id)

    let status: SensorAlertStatus
    let since: string | undefined
    if (openedAt) {
      status = 'active'
      since = openedAt
    } else if (rule.last_error) {
      // The engine records an unparseable definition here too, so this covers
      // both delivery failures and broken rules.
      status = 'error'
    } else if (endedAt && nowMs - Date.parse(endedAt) < RECENTLY_COMPLETED_MS) {
      status = 'completed'
      since = endedAt
    } else if (rule.enabled !== 1) {
      status = 'paused'
    } else {
      status = 'inactive'
    }

    const current = summaries.get(rule.sensor_id)
    if (!current) {
      summaries.set(rule.sensor_id, { status, ruleName: rule.name, ruleCount: 1, since })
    } else {
      const wins = STATUS_RANK[status] < STATUS_RANK[current.status]
      summaries.set(rule.sensor_id, {
        status: wins ? status : current.status,
        ruleName: wins ? rule.name : current.ruleName,
        since: wins ? since : current.since,
        ruleCount: current.ruleCount + 1,
      })
    }
  }
  return summaries
}

export async function listRecentEvents(limit = 100): Promise<AlertEvent[]> {
  const rows = getDb()
    .prepare('SELECT * FROM alert_events ORDER BY started_at DESC LIMIT ?')
    .all(limit) as EventRow[]
  return rows.map(rowToEvent)
}
