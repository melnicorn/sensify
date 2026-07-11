import { describe, it, expect } from 'vitest'
import { parsePath, getAtPath, isCapturable, toMetricValue, joinPath } from './json-path'

describe('parsePath / getAtPath', () => {
  const doc = {
    apower: 12.5,
    aenergy: { total: 54.7, by_minute: [1, 2, 3] },
    channels: [{ power: 5 }, { power: 9 }],
    flags: { on: true },
  }

  it('resolves dot and bracket paths', () => {
    expect(getAtPath(doc, 'apower')).toBe(12.5)
    expect(getAtPath(doc, 'aenergy.total')).toBe(54.7)
    expect(getAtPath(doc, 'aenergy.by_minute[2]')).toBe(3)
    expect(getAtPath(doc, 'channels[1].power')).toBe(9)
    expect(getAtPath([{ x: 1 }], '[0].x')).toBe(1)
  })

  it('returns undefined for anything that does not resolve', () => {
    expect(getAtPath(doc, 'nope')).toBeUndefined()
    expect(getAtPath(doc, 'aenergy.by_minute[9]')).toBeUndefined()
    expect(getAtPath(doc, 'apower.deeper')).toBeUndefined()
    expect(getAtPath(doc, 'channels.power')).toBeUndefined() // array needs an index
    expect(getAtPath(null, 'x')).toBeUndefined()
  })

  it('parses mixed tokens', () => {
    expect(parsePath('channels[2].power')).toEqual(['channels', 2, 'power'])
    expect(parsePath('[0].apower')).toEqual([0, 'apower'])
  })

  it('joinPath is the inverse convention', () => {
    expect(joinPath('', 'apower')).toBe('apower')
    expect(joinPath('aenergy', 'total')).toBe('aenergy.total')
    expect(joinPath('channels', 1)).toBe('channels[1]')
  })
})

describe('isCapturable / toMetricValue', () => {
  it('captures finite numbers and booleans only', () => {
    expect(isCapturable(1.5)).toBe(true)
    expect(isCapturable(true)).toBe(true)
    expect(isCapturable(NaN)).toBe(false)
    expect(isCapturable(Infinity)).toBe(false)
    expect(isCapturable('5')).toBe(false)
    expect(isCapturable(null)).toBe(false)
    expect(isCapturable({})).toBe(false)
  })

  it('maps booleans to 0/1', () => {
    expect(toMetricValue(true)).toBe(1)
    expect(toMetricValue(false)).toBe(0)
    expect(toMetricValue(3.7)).toBe(3.7)
  })
})
