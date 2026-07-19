// Phase-4 guarantee: moving a sensor onto MQTT is an in-place edit of the
// existing row, not a re-registration — so its readings survive and new ones
// continue in the same metric series (no silently forked chart).
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dir = mkdtempSync(path.join(tmpdir(), 'sensify-convert-test-'))
process.env.DATA_DIR = dir

const repo = await import('./repo')

const SHELLY_FIELDS = [
  { path: 'apower', metric: 'apower', unit: 'W' },
  { path: 'temperature.tC', metric: 'temp', unit: 'C' },
]

describe('converting a pull sensor to MQTT in place', () => {
  it('keeps the same sensor row, its history, and continues the same series', async () => {
    const id = await repo.createPullSensor({
      name: 'Washer plug',
      url: 'http://192.168.1.50/rpc/Switch.GetStatus?id=0',
      pollInterval: 30,
      fields: SHELLY_FIELDS,
    })

    // History from the pull era
    await repo.recordPollSuccess(id, '{}', [{ metric: 'apower', value: 12.5 }], null)
    await repo.recordPollSuccess(id, '{}', [{ metric: 'apower', value: 13.5 }], null)
    expect(await repo.getReadings(id)).toHaveLength(2)

    // The Shelly's status/switch:0 payload has the same shape the pull path
    // fetched, so the field paths (and metric names) transfer unchanged.
    await repo.convertSensorToMqtt(id, {
      name: 'Washer plug',
      topic: 'shellyplugusg4-abc/status/switch:0',
      fields: SHELLY_FIELDS,
    })

    const meta = await repo.getSensorMeta(id)
    expect(meta?.id).toBe(id) // same row — identity survived the transport switch
    expect(meta?.type).toBe('mqtt')
    expect(meta?.pull).toBeUndefined() // pull config cleared
    expect(meta?.mqtt?.topic).toBe('shellyplugusg4-abc/status/switch:0')
    expect(meta?.mqtt?.fields.map((f) => f.metric).sort()).toEqual(['apower', 'temp'])

    // Pre-switch history is untouched
    expect(await repo.getReadings(id)).toHaveLength(2)

    // ...and a new MQTT reading lands in the *same* metric series
    await repo.recordMqttReading(id, '{}', [{ metric: 'apower', value: 14.5 }])
    const apower = (await repo.getReadings(id))
      .filter((r) => r.metric === 'apower')
      .map((r) => r.value)
      .sort((a, b) => a - b)
    expect(apower).toEqual([12.5, 13.5, 14.5])
  })

  it('does not leave a forked second sensor behind', async () => {
    expect(await repo.listSensors()).toHaveLength(1)
  })
})
