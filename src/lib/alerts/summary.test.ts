// Dashboard alert summary: one compact status per sensor, with precedence when
// a sensor has several rules that disagree.
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { RuleDefinition } from './schemas'

const dir = mkdtempSync(path.join(tmpdir(), 'sensify-alert-summary-test-'))
process.env.DATA_DIR = dir

const repo = await import('./repo')
const mainRepo = await import('../repo')

const DEF: RuleDefinition = {
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

let n = 0
async function newSensor(): Promise<string> {
  return mainRepo.createPullSensor({
    name: `sensor-${n++}`,
    url: 'http://example.invalid/status',
    pollInterval: 60,
    fields: [{ path: 'apower', metric: 'apower' }],
  })
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

describe('listSensorAlertSummaries', () => {
  it('omits sensors that have no rules', async () => {
    const sensorId = await newSensor()
    const summaries = await repo.listSensorAlertSummaries()
    expect(summaries.has(sensorId)).toBe(false)
  })

  it('reports an open event as active', async () => {
    const sensorId = await newSensor()
    const ruleId = await repo.createRule({ sensorId, name: 'Washer', definition: DEF, channelIds: [] })
    repo.openEvent(ruleId, iso(5 * 60_000), { count: 1, min: 1, max: 1, sum: 1, last: 1 })

    const s = (await repo.listSensorAlertSummaries()).get(sensorId)!
    expect(s.status).toBe('active')
    expect(s.ruleName).toBe('Washer')
    expect(s.ruleCount).toBe(1)
  })

  it('reports a recently finished event as completed, and an old one as inactive', async () => {
    const sensorId = await newSensor()
    const ruleId = await repo.createRule({ sensorId, name: 'Cycle', definition: DEF, channelIds: [] })
    const stats = { count: 1, min: 1, max: 1, sum: 1, last: 1 }
    const eventId = repo.openEvent(ruleId, iso(90 * 60_000), stats)
    repo.closeEvent(eventId, iso(10 * 60_000), stats) // ended 10 min ago

    expect((await repo.listSensorAlertSummaries()).get(sensorId)!.status).toBe('completed')

    // Same data, evaluated two hours later: outside the one-hour window
    const later = Date.now() + 2 * 60 * 60_000
    expect((await repo.listSensorAlertSummaries(later)).get(sensorId)!.status).toBe('inactive')
  })

  it('reports a disabled rule as paused and a rule error as error', async () => {
    const pausedSensor = await newSensor()
    const pausedRule = await repo.createRule({
      sensorId: pausedSensor,
      name: 'Muted',
      definition: DEF,
      channelIds: [],
    })
    await repo.setRuleEnabled(pausedRule, false)
    expect((await repo.listSensorAlertSummaries()).get(pausedSensor)!.status).toBe('paused')

    const errorSensor = await newSensor()
    const errorRule = await repo.createRule({
      sensorId: errorSensor,
      name: 'Broken',
      definition: DEF,
      channelIds: [],
    })
    repo.recordRuleError(errorRule, 'notification failed: boom')
    expect((await repo.listSensorAlertSummaries()).get(errorSensor)!.status).toBe('error')
  })

  it('takes the most urgent rule when several disagree, and counts them all', async () => {
    const sensorId = await newSensor()
    const quiet = await repo.createRule({ sensorId, name: 'Quiet', definition: DEF, channelIds: [] })
    await repo.setRuleEnabled(quiet, false)
    await repo.createRule({ sensorId, name: 'Idle', definition: DEF, channelIds: [] })
    const firing = await repo.createRule({ sensorId, name: 'Firing', definition: DEF, channelIds: [] })
    repo.openEvent(firing, iso(60_000), { count: 1, min: 1, max: 1, sum: 1, last: 1 })

    const s = (await repo.listSensorAlertSummaries()).get(sensorId)!
    expect(s.status).toBe('active') // active outranks paused and inactive
    expect(s.ruleName).toBe('Firing') // and names the rule that won
    expect(s.ruleCount).toBe(3)
  })
})

describe('deleteReadingsForMetrics', () => {
  it('drops only the named metrics', async () => {
    const sensorId = await newSensor()
    await mainRepo.recordPollSuccess(
      sensorId,
      '{}',
      [
        { metric: 'apower', value: 5 },
        { metric: 'temp', value: 20 },
      ],
      null
    )
    expect(await mainRepo.getReadings(sensorId)).toHaveLength(2)

    const deleted = await mainRepo.deleteReadingsForMetrics(sensorId, ['temp'])
    expect(deleted).toBe(1)
    const left = await mainRepo.getReadings(sensorId)
    expect(left.map((r) => r.metric)).toEqual(['apower'])
  })

  it('is a no-op for an empty list', async () => {
    const sensorId = await newSensor()
    expect(await mainRepo.deleteReadingsForMetrics(sensorId, [])).toBe(0)
  })
})
