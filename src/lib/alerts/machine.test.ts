import { describe, it, expect } from 'vitest'
import {
  computeSignal,
  conditionMet,
  defaultEnd,
  stepMachine,
  type MachineState,
  type SignalPoint,
  type Transition,
} from './machine'
import type { RuleDefinition } from './schemas'

const SEC = 1000

function pts(...pairs: [number, number][]): SignalPoint[] {
  return pairs.map(([s, value]) => ({ tsMs: s * SEC, value }))
}

describe('computeSignal', () => {
  it('returns null with no data at or before atMs', () => {
    expect(computeSignal([], 'avg', 60, 100 * SEC)).toBeNull()
    expect(computeSignal(pts([200, 5]), 'avg', 60, 100 * SEC)).toBeNull()
  })

  it('returns the latest value for windowS 0 and for agg last', () => {
    const p = pts([0, 1], [30, 2], [60, 3])
    expect(computeSignal(p, 'avg', 0, 60 * SEC)).toBe(3)
    expect(computeSignal(p, 'last', 300, 60 * SEC)).toBe(3)
  })

  it('ignores samples after atMs', () => {
    const p = pts([0, 1], [30, 2], [60, 99])
    expect(computeSignal(p, 'last', 0, 30 * SEC)).toBe(2)
  })

  it('time-weights the average over irregular samples', () => {
    // 10 for 30s, then 40 for 30s -> avg 25 over a 60s window
    const p = pts([0, 10], [30, 40])
    expect(computeSignal(p, 'avg', 60, 60 * SEC)).toBe(25)
    // Uneven: 0 for 50s, then 100 for 10s -> avg 100*10/60
    const q = pts([0, 0], [50, 100])
    expect(computeSignal(q, 'avg', 60, 60 * SEC)).toBeCloseTo(100 * (10 / 60))
  })

  it('clamps the sample before the window start to the boundary', () => {
    // Sample at t=0 holds through the window that starts at t=40
    const p = pts([0, 10], [70, 20])
    // Window [40, 100]: value 10 for 30s, 20 for 30s -> 15
    expect(computeSignal(p, 'avg', 60, 100 * SEC)).toBe(15)
  })

  it('holds the last value when all samples predate the window', () => {
    expect(computeSignal(pts([0, 7]), 'avg', 60, 1000 * SEC)).toBe(7)
  })

  it('computes min and max over the window including the boundary sample', () => {
    const p = pts([0, 5], [50, 50], [80, 20])
    expect(computeSignal(p, 'max', 60, 100 * SEC)).toBe(50)
    expect(computeSignal(p, 'min', 60, 100 * SEC)).toBe(5) // t=0 sample in effect at window start
  })
})

describe('conditionMet / defaultEnd', () => {
  it('evaluates all operators', () => {
    expect(conditionMet({ op: '>', value: 5, holdS: 0 }, 6)).toBe(true)
    expect(conditionMet({ op: '>', value: 5, holdS: 0 }, 5)).toBe(false)
    expect(conditionMet({ op: '>=', value: 5, holdS: 0 }, 5)).toBe(true)
    expect(conditionMet({ op: '<', value: 5, holdS: 0 }, 4)).toBe(true)
    expect(conditionMet({ op: '<=', value: 5, holdS: 0 }, 5)).toBe(true)
  })

  it('negates the start condition exactly', () => {
    expect(defaultEnd({ op: '>', value: 5, holdS: 60 })).toEqual({ op: '<=', value: 5, holdS: 0 })
    expect(defaultEnd({ op: '<=', value: 5, holdS: 60 })).toEqual({ op: '>', value: 5, holdS: 0 })
  })
})

// ---------- state machine ----------

const DEF: RuleDefinition = {
  v: 1,
  trigger: {
    kind: 'level',
    metric: 'apower',
    signal: { agg: 'last', windowS: 0 },
    start: { op: '>', value: 10, holdS: 60 },
    end: { op: '<=', value: 10, holdS: 120 },
  },
  cooldownS: 300,
  notify: {},
}

/** Drive the machine over (secondsOffset, signal) samples; collect transitions. */
function run(def: RuleDefinition, samples: [number, number][], startState?: MachineState) {
  let state = startState ?? { phase: 'idle' as const, phaseSinceMs: 0 }
  const transitions: (Transition & { confirmedAtS: number })[] = []
  for (const [s, signal] of samples) {
    const result = stepMachine(def, state, signal, s * SEC)
    state = result.state
    transitions.push(...result.transitions.map((t) => ({ ...t, confirmedAtS: s })))
  }
  return { state, transitions }
}

describe('stepMachine', () => {
  it('fires start once after the hold and backdates it to condition onset', () => {
    const { state, transitions } = run(DEF, [
      [0, 1],
      [30, 50], // condition first holds here
      [60, 60],
      [95, 70], // 65s held -> start confirmed
      [120, 80],
    ])
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({ type: 'start', atMs: 30 * SEC, confirmedAtS: 95 })
    expect(state.phase).toBe('active')
  })

  it('a blip shorter than the start hold never fires', () => {
    const { state, transitions } = run(DEF, [
      [0, 1],
      [30, 50],
      [60, 1], // dropped before 60s held
      [90, 1],
    ])
    expect(transitions).toHaveLength(0)
    expect(state.phase).toBe('idle')
  })

  it('starts immediately when holdS is 0', () => {
    const def = { ...DEF, trigger: { ...DEF.trigger, start: { op: '>' as const, value: 10, holdS: 0 } } }
    const { transitions } = run(def, [[0, 50]])
    expect(transitions).toEqual([{ type: 'start', atMs: 0, confirmedAtS: 0 }])
  })

  it('recovers from clearing without an end alert when the signal comes back', () => {
    const { state, transitions } = run(DEF, [
      [0, 50],
      [70, 50], // active
      [100, 5], // clearing
      [150, 50], // recovered before 120s end hold
      [200, 50],
    ])
    expect(transitions.map((t) => t.type)).toEqual(['start'])
    expect(state.phase).toBe('active')
  })

  it('fires end once after the end hold, backdated, then enters cooldown', () => {
    const { state, transitions } = run(DEF, [
      [0, 50],
      [70, 50], // active
      [100, 5], // end condition first holds
      [180, 5],
      [225, 5], // 125s held -> end confirmed
    ])
    expect(transitions.map((t) => t.type)).toEqual(['start', 'end'])
    expect(transitions[1]).toMatchObject({ type: 'end', atMs: 100 * SEC, confirmedAtS: 225 })
    expect(state.phase).toBe('cooldown')
    // Cooldown is backdated to when the event actually ended
    expect(state.phaseSinceMs).toBe(100 * SEC)
  })

  it('suppresses re-triggers during cooldown, then re-arms', () => {
    const afterEnd = run(DEF, [
      [0, 50],
      [70, 50],
      [100, 5],
      [225, 5], // end -> cooldown since t=100
    ])
    // Retrigger at t=250 (only 150s into a 300s cooldown): ignored
    const during = run(DEF, [[250, 99]], afterEnd.state)
    expect(during.transitions).toHaveLength(0)
    expect(during.state.phase).toBe('cooldown')
    // At t=460 the cooldown (ends t=400) has expired: pending starts fresh
    const after = run(DEF, [[460, 99]], during.state)
    expect(after.state.phase).toBe('pending')
  })

  it('goes straight to idle after end when cooldownS is 0', () => {
    const def = { ...DEF, cooldownS: 0 }
    const { state } = run(def, [
      [0, 50],
      [70, 50],
      [100, 5],
      [225, 5],
    ])
    expect(state.phase).toBe('idle')
  })

  it('never changes phase on null signal', () => {
    const active = run(DEF, [
      [0, 50],
      [70, 50],
    ]).state
    const result = stepMachine(DEF, active, null, 500 * SEC)
    expect(result.state).toEqual(active)
    expect(result.transitions).toHaveLength(0)
  })

  it('stays active in the hysteresis dead zone (neither tripped nor cleared)', () => {
    const def: RuleDefinition = {
      ...DEF,
      trigger: {
        ...DEF.trigger,
        start: { op: '>', value: 10, holdS: 0 },
        end: { op: '<', value: 5, holdS: 0 },
      },
    }
    const { state, transitions } = run(def, [
      [0, 50], // start
      [30, 7], // between 5 and 10: dead zone
      [60, 7],
    ])
    expect(transitions.map((t) => t.type)).toEqual(['start'])
    expect(state.phase).toBe('active')
  })
})
