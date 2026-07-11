import { describe, it, expect } from 'vitest'
import { fitLevelRule, backtestRule, type FitResult } from './fit'
import type { SignalPoint } from './machine'
import type { RuleDefinition } from './schemas'
import washerRaw from './__fixtures__/washer-apower.json'

// Real captured data: a washer plug's apower over ~4 hours containing exactly
// one wash cycle (00:28–01:11 UTC), noisy 12–292 W, with a ~6.6 W "done"
// plateau before returning to ~1.1 W standby.
const washer: SignalPoint[] = washerRaw.map((r: { ts: string; value: number }) => ({
  tsMs: Date.parse(r.ts),
  value: r.value,
}))

const CYCLE_START = Date.parse('2026-07-11T00:28:00Z')
const CYCLE_END = Date.parse('2026-07-11T01:12:00Z')

function defFrom(fit: FitResult): RuleDefinition {
  return { v: 1, trigger: fit.trigger, cooldownS: fit.cooldownS, notify: {} }
}

describe('fitLevelRule on the captured wash cycle', () => {
  it('fits a threshold separating baseline from the running washer', () => {
    const fit = fitLevelRule(washer, { fromMs: CYCLE_START, toMs: CYCLE_END }, 'apower')
    if ('error' in fit) throw new Error(fit.error)
    expect(fit.diagnostics.direction).toBe('above')
    // Baseline tops out ~1.2 W; the event floor is ~6.6 W
    expect(fit.trigger.start.value).toBeGreaterThan(1.2)
    expect(fit.trigger.start.value).toBeLessThan(6.6)
    expect(fit.trigger.start.op).toBe('>')
  })

  it('backtests to exactly one event covering the cycle', () => {
    const fit = fitLevelRule(washer, { fromMs: CYCLE_START, toMs: CYCLE_END }, 'apower')
    if ('error' in fit) throw new Error(fit.error)
    const events = backtestRule(defFrom(fit), washer)
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event!.endMs).not.toBeNull()
    const durationMin = (event!.endMs! - event!.startMs) / 60_000
    expect(durationMin).toBeGreaterThan(30)
    expect(durationMin).toBeLessThan(60)
    expect(event!.max).toBe(292)
  })

  it('survives a sloppy drag that includes baseline padding', () => {
    // 12 minutes of standby before the cycle, tail into standby after
    const sloppy = {
      fromMs: Date.parse('2026-07-11T00:16:00Z'),
      toMs: Date.parse('2026-07-11T01:16:00Z'),
    }
    const fit = fitLevelRule(washer, sloppy, 'apower')
    if ('error' in fit) throw new Error(fit.error)
    expect(fit.trigger.start.value).toBeGreaterThan(1.2)
    expect(backtestRule(defFrom(fit), washer)).toHaveLength(1)
  })

  it('rejects a selection over flat baseline', () => {
    const flat = {
      fromMs: Date.parse('2026-07-10T22:00:00Z'),
      toMs: Date.parse('2026-07-10T23:00:00Z'),
    }
    const fit = fitLevelRule(washer, flat, 'apower')
    expect(fit).toHaveProperty('error')
  })

  it('rejects selections with too little data', () => {
    expect(fitLevelRule(washer.slice(0, 2), { fromMs: 0, toMs: 1 }, 'apower')).toHaveProperty(
      'error'
    )
  })
})

describe('fitLevelRule below-baseline events', () => {
  it('fits a "below" rule when the selection drops under the baseline', () => {
    // Freezer-door style: steady 50, drops to 10 for five minutes
    const points: SignalPoint[] = []
    for (let s = 0; s < 1800; s += 30) {
      const inEvent = s >= 600 && s < 900
      points.push({ tsMs: s * 1000, value: inEvent ? 10 + (s % 60) / 60 : 50 + (s % 90) / 90 })
    }
    const fit = fitLevelRule(points, { fromMs: 600_000, toMs: 900_000 }, 'temp')
    if ('error' in fit) throw new Error(fit.error)
    expect(fit.diagnostics.direction).toBe('below')
    expect(fit.trigger.start.op).toBe('<')
    expect(fit.trigger.start.value).toBeLessThan(50)
    expect(fit.trigger.start.value).toBeGreaterThan(11)
    expect(backtestRule(defFrom(fit), points)).toHaveLength(1)
  })
})

describe('backtestRule', () => {
  const def = (cooldownS: number): RuleDefinition => ({
    v: 1,
    trigger: {
      kind: 'level',
      metric: 'm',
      signal: { agg: 'last', windowS: 0 },
      start: { op: '>', value: 10, holdS: 0 },
      end: { op: '<=', value: 10, holdS: 0 },
    },
    cooldownS,
    notify: {},
  })

  function twoPulses(gapS: number): SignalPoint[] {
    const points: SignalPoint[] = []
    for (let s = 0; s <= 600; s += 10) {
      const p1 = s >= 60 && s < 120
      const p2 = s >= 120 + gapS && s < 180 + gapS
      points.push({ tsMs: s * 1000, value: p1 || p2 ? 100 : 0 })
    }
    return points
  }

  it('detects separate pulses as separate events', () => {
    expect(backtestRule(def(0), twoPulses(120))).toHaveLength(2)
  })

  it('cooldown suppresses a pulse that re-fires too soon', () => {
    // Second pulse starts 30s after the first ends; 300s cooldown swallows it
    expect(backtestRule(def(300), twoPulses(30))).toHaveLength(1)
  })

  it('leaves the last event open when history ends mid-event', () => {
    const points: SignalPoint[] = []
    for (let s = 0; s <= 300; s += 10) points.push({ tsMs: s * 1000, value: s >= 120 ? 100 : 0 })
    const events = backtestRule(def(0), points)
    expect(events).toHaveLength(1)
    expect(events[0]!.endMs).toBeNull()
  })

  it('handles empty history', () => {
    expect(backtestRule(def(0), [])).toEqual([])
  })
})
