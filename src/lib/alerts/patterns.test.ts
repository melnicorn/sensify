import { describe, it, expect } from 'vitest'
import { derivePatternRule, PATTERNS, type Sensitivity } from './patterns'
import { backtestRule } from './fit'
import type { SignalPoint } from './machine'
import type { RuleDefinition } from './schemas'
import washerRaw from './__fixtures__/washer-apower.json'

const washer: SignalPoint[] = washerRaw.map((r: { ts: string; value: number }) => ({
  tsMs: Date.parse(r.ts),
  value: r.value,
}))

function defFrom(d: { trigger: RuleDefinition['trigger']; cooldownS: number }): RuleDefinition {
  return { v: 1, trigger: d.trigger, cooldownS: d.cooldownS, notify: {} }
}

describe('derivePatternRule on the captured washer history', () => {
  it('pulse derives a threshold in the standby/running gap without an example event', () => {
    const d = derivePatternRule(washer, 'pulse', 'medium', 'apower')
    if ('error' in d) throw new Error(d.error)
    // Standby tops out ~2.7 W; the gentlest running level is ~12 W
    expect(d.trigger.start.value).toBeGreaterThan(2.7)
    expect(d.trigger.start.value).toBeLessThan(12)
    expect(d.notifyEnd).toBe(true)
  })

  it('the derived pulse rule backtests to exactly the one real cycle', () => {
    const d = derivePatternRule(washer, 'pulse', 'medium', 'apower')
    if ('error' in d) throw new Error(d.error)
    const events = backtestRule(defFrom(d), washer)
    expect(events).toHaveLength(1)
    expect(events[0]!.max).toBe(292)
  })

  it('is robust where mean+stddev is not', () => {
    // The naive threshold (mean + 3σ ≈ 226 W) sits above most of the cycle;
    // the robust one must stay below the cycle's typical low end
    const d = derivePatternRule(washer, 'pulse', 'low', 'apower')
    if ('error' in d) throw new Error(d.error)
    expect(d.trigger.start.value).toBeLessThan(15)
  })
})

describe('derivePatternRule mechanics', () => {
  // Noisy flat baseline around 50 (humidity-like)
  const baseline: SignalPoint[] = Array.from({ length: 500 }, (_, i) => ({
    tsMs: i * 30_000,
    value: 50 + Math.sin(i / 7) * 1.5,
  }))

  it('sensitivity orders thresholds: high fires earliest', () => {
    const at = (s: Sensitivity) => {
      const d = derivePatternRule(baseline, 'spike', s, 'humidity')
      if ('error' in d) throw new Error(d.error)
      return d.trigger.start.value
    }
    expect(at('high')).toBeLessThan(at('medium'))
    expect(at('medium')).toBeLessThan(at('low'))
    expect(at('high')).toBeGreaterThan(51.5) // above the noise band
  })

  it('spike uses value hysteresis: end threshold sits below start', () => {
    const d = derivePatternRule(baseline, 'spike', 'medium', 'humidity')
    if ('error' in d) throw new Error(d.error)
    expect(d.trigger.end!.value).toBeLessThan(d.trigger.start.value)
    expect(d.trigger.end!.value).toBeGreaterThan(50)
  })

  it('dip mirrors spike below the baseline', () => {
    const d = derivePatternRule(baseline, 'dip', 'medium', 'humidity')
    if ('error' in d) throw new Error(d.error)
    expect(d.trigger.start.op).toBe('<')
    expect(d.trigger.start.value).toBeLessThan(48.5)
    expect(d.trigger.end!.value).toBeGreaterThan(d.trigger.start.value)
  })

  it('level-shift patterns suppress the end notification', () => {
    const rise = derivePatternRule(baseline, 'rise-hold', 'medium', 'x')
    const fall = derivePatternRule(baseline, 'fall-hold', 'medium', 'x')
    if ('error' in rise || 'error' in fall) throw new Error('unexpected')
    expect(rise.notifyEnd).toBe(false)
    expect(fall.notifyEnd).toBe(false)
    expect(rise.trigger.start.op).toBe('>')
    expect(fall.trigger.start.op).toBe('<')
  })

  it('handles a dead-flat baseline (MAD 0) with a floored spread', () => {
    const flat: SignalPoint[] = Array.from({ length: 100 }, (_, i) => ({
      tsMs: i * 30_000,
      value: 0,
    }))
    const d = derivePatternRule(flat, 'pulse', 'medium', 'apower')
    if ('error' in d) throw new Error(d.error)
    expect(d.trigger.start.value).toBeGreaterThan(0)
    expect(d.trigger.start.value).toBeLessThan(1)
  })

  it('rejects insufficient history', () => {
    expect(derivePatternRule(baseline.slice(0, 5), 'spike', 'medium', 'x')).toHaveProperty('error')
  })

  it('every advertised pattern derives successfully', () => {
    for (const p of PATTERNS) {
      expect(derivePatternRule(baseline, p.id, 'medium', 'x'), p.id).not.toHaveProperty('error')
    }
  })
})
