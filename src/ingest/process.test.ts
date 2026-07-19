import { describe, it, expect } from 'vitest'
import { processMessage } from './process'
import type { SensorMeta, PullField } from '../lib/types'

function mqttSensor(id: string, fields: PullField[]): SensorMeta {
  return {
    id,
    type: 'mqtt',
    name: id,
    firstSeen: '2026-07-01T00:00:00.000Z',
    lastSeen: '2026-07-01T00:00:00.000Z',
    mqtt: { topic: `home/${id}`, qos: 1, enabled: true, fields, consecutiveFailures: 0 },
  }
}

const buf = (s: string) => Buffer.from(s, 'utf8')

describe('processMessage', () => {
  const sensor = mqttSensor('s1', [
    { path: 'temperature.value', metric: 'temperature', unit: 'C', unitKind: 'temperature' },
    { path: 'humidity.value', metric: 'humidity' },
  ])

  it('drops retained messages (never fabricates a reading from replayed state)', () => {
    const result = processMessage([sensor], buf('{"temperature":{"value":21}}'), true)
    expect(result.retainedDropped).toBe(true)
    expect(result.persist).toEqual([])
    expect(result.failures).toEqual([])
  })

  it('extracts configured fields from a live (non-retained) message', () => {
    const result = processMessage(
      [sensor],
      buf('{"temperature":{"value":21.5},"humidity":{"value":48}}'),
      false
    )
    expect(result.retainedDropped).toBe(false)
    expect(result.persist).toHaveLength(1)
    expect(result.persist[0]!.sensorId).toBe('s1')
    expect(result.persist[0]!.metrics).toEqual([
      { metric: 'temperature', value: 21.5 },
      { metric: 'humidity', value: 48 },
    ])
  })

  it('canonicalizes temperature fields to °C', () => {
    const fSensor = mqttSensor('f1', [
      { path: 'tempF', metric: 'temp', unit: 'F', unitKind: 'temperature' },
    ])
    const result = processMessage([fSensor], buf('{"tempF":212}'), false)
    expect(result.persist[0]!.metrics[0]!.value).toBeCloseTo(100) // 212°F → 100°C
  })

  it('records a soft failure when no configured field resolves', () => {
    const result = processMessage([sensor], buf('{"unrelated":1}'), false)
    expect(result.persist).toEqual([])
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.reason).toContain('No configured fields resolved')
  })

  it('records a soft failure for a non-JSON payload', () => {
    const result = processMessage([sensor], buf('not json'), false)
    expect(result.failures[0]!.reason).toBe('Payload is not JSON')
  })

  it('stores booleans as 0/1', () => {
    const bSensor = mqttSensor('b1', [{ path: 'output', metric: 'output' }])
    const result = processMessage([bSensor], buf('{"output":true}'), false)
    expect(result.persist[0]!.metrics[0]).toEqual({ metric: 'output', value: 1 })
  })
})
