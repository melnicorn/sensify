import { describe, it, expect } from 'vitest'
import { describeRule } from './describe'
import type { RuleDefinition } from './schemas'

function def(overrides: Partial<RuleDefinition['trigger']>): RuleDefinition {
  return {
    v: 1,
    trigger: {
      kind: 'level',
      metric: 'apower',
      signal: { agg: 'avg', windowS: 120 },
      start: { op: '>', value: 8, holdS: 60 },
      end: { op: '<=', value: 8, holdS: 180 },
      ...overrides,
    },
    cooldownS: 300,
    notify: {},
  }
}

describe('describeRule', () => {
  it('renders the full sentence', () => {
    expect(describeRule(def({}))).toBe('Apower (2min avg) > 8 for 1min, ends <= 8 for 3min')
  })

  it('uses seconds for non-whole minutes', () => {
    expect(describeRule(def({ start: { op: '>', value: 8, holdS: 90 } }))).toContain('for 90s')
  })

  it('labels windowless signals as each reading', () => {
    expect(describeRule(def({ signal: { agg: 'avg', windowS: 0 } }))).toContain('(each reading)')
  })

  it('omits the hold when zero and the end clause when absent', () => {
    const d = def({ start: { op: '>', value: 8, holdS: 0 }, end: undefined })
    expect(describeRule(d)).toBe('Apower (2min avg) > 8')
  })

  it('mentions the delivery window when set', () => {
    const allowed = { ...def({}), notifyWindow: { mode: 'allow' as const, fromH: 8, toH: 22 } }
    expect(describeRule(allowed)).toContain('· notifies 08:00–22:00')
    const muted = { ...def({}), notifyWindow: { mode: 'block' as const, fromH: 22, toH: 7 } }
    expect(describeRule(muted)).toContain('· muted 22:00–07:00')
  })
})
