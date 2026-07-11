// Integration tests for the live engine against a real (temporary) SQLite
// database — the same code path production ingest uses. DATA_DIR must be set
// before the db module loads, hence the dynamic imports.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'sensify-engine-test-'))

const { getDb } = await import('../db')
const { evaluateReading, sweepOpenRules, clearRuleCache, renderTemplate } = await import('./engine')
const { createRule, updateRule, getRuleState, listEventsForRule, getRule } = await import('./repo')
import type { RuleDefinition as RuleDef } from './schemas'

const DEF: RuleDef = {
  v: 1,
  trigger: {
    kind: 'level',
    metric: 'apower',
    signal: { agg: 'last', windowS: 0 },
    start: { op: '>', value: 10, holdS: 30 },
    end: { op: '<=', value: 10, holdS: 60 },
  },
  cooldownS: 0,
  notify: {},
}

let seq = 0

function newSensor(): string {
  const id = `sensor-${++seq}`
  getDb()
    .prepare(
      `INSERT INTO sensors (id, type, name, first_seen, last_seen) VALUES (?, 'pull', ?, ?, ?)`
    )
    .run(id, `Sensor ${seq}`, new Date().toISOString(), new Date().toISOString())
  return id
}

/** Insert a reading and run it through the real ingest hook. */
function ingest(sensorId: string, atMs: number, value: number): void {
  const ts = new Date(atMs).toISOString()
  getDb()
    .prepare("INSERT INTO readings (sensor_id, ts, metric, value) VALUES (?, ?, 'apower', ?)")
    .run(sensorId, ts, value)
  evaluateReading(sensorId, 'apower', value, ts)
}

beforeEach(() => clearRuleCache())

describe('engine end to end', () => {
  it('records one event with stats for a square pulse and returns to idle', async () => {
    const sensorId = newSensor()
    const ruleId = await createRule({ sensorId, name: 'Pulse', definition: DEF, channelIds: [] })

    const t0 = Date.now() - 600_000
    ingest(sensorId, t0, 1)
    ingest(sensorId, t0 + 30_000, 50) // condition onset
    ingest(sensorId, t0 + 65_000, 80) // 35s held -> start (event opens)
    ingest(sensorId, t0 + 95_000, 200)
    ingest(sensorId, t0 + 125_000, 5) // end condition onset
    ingest(sensorId, t0 + 190_000, 1) // 65s held -> end

    const events = await listEventsForRule(ruleId)
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.startedAt).toBe(new Date(t0 + 30_000).toISOString())
    expect(event!.endedAt).toBe(new Date(t0 + 125_000).toISOString())
    expect(event!.stats!.max).toBe(200)

    const state = getRuleState(ruleId)
    expect(state?.phase).toBe('idle')
    expect(state?.eventId).toBeNull()
    expect((await getRule(ruleId))?.lastError).toBeNull()
  })

  it('editing a rule resets its state and quietly closes an open event', async () => {
    const sensorId = newSensor()
    const ruleId = await createRule({ sensorId, name: 'Edit me', definition: DEF, channelIds: [] })

    const t0 = Date.now() - 600_000
    ingest(sensorId, t0, 50)
    ingest(sensorId, t0 + 40_000, 60) // start -> active, event open
    expect(getRuleState(ruleId)?.phase).toBe('active')

    await updateRule(ruleId, { name: 'Edited', definition: { ...DEF, cooldownS: 60 }, channelIds: [] })
    clearRuleCache()
    ingest(sensorId, t0 + 70_000, 1) // first evaluation after the edit

    const state = getRuleState(ruleId)
    expect(state?.eventId).toBeNull()
    const events = await listEventsForRule(ruleId)
    expect(events).toHaveLength(1)
    expect(events[0]!.endedAt).not.toBeNull() // orphan closed, no crash
  })

  it('sweepOpenRules confirms an end whose dwell expires between readings', async () => {
    const sensorId = newSensor()
    const ruleId = await createRule({ sensorId, name: 'Sweep', definition: DEF, channelIds: [] })

    const now = Date.now()
    ingest(sensorId, now - 300_000, 50)
    ingest(sensorId, now - 260_000, 60) // active
    ingest(sensorId, now - 70_000, 1) // end onset; held 0s
    ingest(sensorId, now - 65_000, 1) // held 5s of a 60s dwell -> still clearing
    expect(getRuleState(ruleId)?.phase).toBe('clearing')

    // No more readings arrive; the sweeper tick advances the dwell
    sweepOpenRules()
    expect(getRuleState(ruleId)?.phase).toBe('idle')
    const events = await listEventsForRule(ruleId)
    expect(events[0]!.endedAt).toBe(new Date(now - 70_000).toISOString())
  })

  it('a null template suppresses that transition notification', async () => {
    const sensorId = newSensor()
    const ruleId = await createRule({
      sensorId,
      name: 'Quiet end',
      definition: { ...DEF, notify: { onEnd: null } },
      channelIds: [],
    })
    const spy = vi.spyOn(console, 'log')

    const t0 = Date.now() - 600_000
    ingest(sensorId, t0, 50)
    ingest(sensorId, t0 + 40_000, 60) // start fires
    ingest(sensorId, t0 + 70_000, 1)
    ingest(sensorId, t0 + 140_000, 1) // end transition, notification suppressed
    await new Promise((r) => setTimeout(r, 50)) // async notify settles

    const logged = spy.mock.calls.map((args) => String(args[0])).join('\n')
    spy.mockRestore()
    expect(logged).toContain('[alert:start]')
    expect(logged).not.toContain('[alert:end]')
    // The event itself is still recorded — only the message is suppressed
    const events = await listEventsForRule(ruleId)
    expect(events).toHaveLength(1)
    expect(events[0]!.endedAt).not.toBeNull()
  })

  it('an invalid stored definition disables the rule without breaking ingest', async () => {
    const sensorId = newSensor()
    const ruleId = await createRule({ sensorId, name: 'Broken', definition: DEF, channelIds: [] })
    getDb()
      .prepare('UPDATE alert_rules SET definition = ? WHERE id = ?')
      .run('{"v":1,"trigger":{"kind":"unknown"}}', ruleId)
    clearRuleCache()

    expect(() => ingest(sensorId, Date.now() - 1000, 50)).not.toThrow()
    expect((await getRule(ruleId))?.lastError).toMatch(/kind/)
    expect(await listEventsForRule(ruleId)).toHaveLength(0)
  })
})

describe('renderTemplate', () => {
  it('substitutes known variables and leaves unknown ones intact', () => {
    expect(renderTemplate('{sensor}: {value} W ({nope})', { sensor: 'Washer', value: '12' })).toBe(
      'Washer: 12 W ({nope})'
    )
  })
})
