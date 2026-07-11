// Pure alert state machine + signal math. No database access — the live
// engine (engine.ts) and the backtest/fit library both drive this core, so
// replaying history and evaluating live readings are guaranteed to agree.
import type { Agg, Condition, Op, Phase, RuleDefinition, EventStats } from './schemas'

export interface SignalPoint {
  tsMs: number
  value: number
}

/** Aggregate the signal over the trailing window ending at atMs. Points may
 *  include one sample from before the window; it is clamped to the window
 *  start (a reading's value holds until the next reading). Returns null when
 *  there is no data at or before atMs. */
export function computeSignal(
  points: SignalPoint[],
  agg: Agg,
  windowS: number,
  atMs: number
): number | null {
  const usable = points.filter((p) => p.tsMs <= atMs)
  if (usable.length === 0) return null
  const last = usable[usable.length - 1]!
  if (windowS <= 0 || agg === 'last') return last.value

  const startMs = atMs - windowS * 1000
  // Index of the sample in effect at the window start (last one <= startMs)
  let first = usable.findIndex((p) => p.tsMs > startMs)
  if (first === -1) return last.value // all samples predate the window: value holds
  first = Math.max(0, first - 1)
  const window = usable.slice(first)

  if (agg === 'min') return Math.min(...window.map((p) => p.value))
  if (agg === 'max') return Math.max(...window.map((p) => p.value))

  // Time-weighted average: each sample holds until the next one
  let weighted = 0
  let total = 0
  for (let i = 0; i < window.length; i++) {
    const from = Math.max(window[i]!.tsMs, startMs)
    const to = i + 1 < window.length ? window[i + 1]!.tsMs : atMs
    const dt = to - from
    if (dt <= 0) continue
    weighted += window[i]!.value * dt
    total += dt
  }
  return total > 0 ? weighted / total : last.value
}

export function conditionMet(cond: Condition, signal: number): boolean {
  switch (cond.op) {
    case '>':
      return signal > cond.value
    case '>=':
      return signal >= cond.value
    case '<':
      return signal < cond.value
    case '<=':
      return signal <= cond.value
  }
}

const NEGATED_OP: Record<Op, Op> = { '>': '<=', '>=': '<', '<': '>=', '<=': '>' }

/** The end condition a rule falls back to when none is configured. */
export function defaultEnd(start: Condition): Condition {
  return { op: NEGATED_OP[start.op], value: start.value, holdS: 0 }
}

// ---------- state machine ----------

export interface MachineState {
  phase: Phase
  phaseSinceMs: number
}

export interface Transition {
  type: 'start' | 'end'
  /** When the event actually began/ended: the moment its condition first
   *  held, not when the dwell confirmed it. */
  atMs: number
}

/** Advance the machine one step. `signal` is the aggregated value at `nowMs`
 *  (null = no data, which never changes phase). Returns the next state and
 *  any committed transitions — notifications fire only on these. */
export function stepMachine(
  def: RuleDefinition,
  state: MachineState,
  signal: number | null,
  nowMs: number
): { state: MachineState; transitions: Transition[] } {
  if (signal === null) return { state, transitions: [] }

  const start = def.trigger.start
  const end = def.trigger.end ?? defaultEnd(start)
  const tripped = conditionMet(start, signal)
  const cleared = conditionMet(end, signal)
  const transitions: Transition[] = []
  let { phase, phaseSinceMs } = state

  // A single reading may cross several phases (e.g. idle -> pending -> active
  // when holdS is 0), so loop until the phase settles for this input.
  for (let guard = 0; guard < PHASE_HOPS; guard++) {
    const held = nowMs - phaseSinceMs
    let next: Phase | null = null

    switch (phase) {
      case 'idle':
        if (tripped) next = 'pending'
        break
      case 'pending':
        if (!tripped) next = 'idle'
        else if (held >= start.holdS * 1000) {
          transitions.push({ type: 'start', atMs: phaseSinceMs })
          next = 'active'
        }
        break
      case 'active':
        if (cleared) next = 'clearing'
        break
      case 'clearing':
        if (!cleared) next = 'active'
        else if (held >= end.holdS * 1000) {
          transitions.push({ type: 'end', atMs: phaseSinceMs })
          next = def.cooldownS > 0 ? 'cooldown' : 'idle'
        }
        break
      case 'cooldown':
        if (held >= def.cooldownS * 1000) next = 'idle'
        break
    }

    if (next === null) break
    // Dwell phases date from this evaluation; the post-end phases inherit the
    // moment the event actually ended so cooldown starts then, not at confirm
    const backdated =
      (next === 'cooldown' || (next === 'idle' && phase === 'clearing')) && transitions.length > 0
        ? transitions[transitions.length - 1]!.atMs
        : nowMs
    phase = next
    phaseSinceMs = backdated
  }

  return { state: { phase, phaseSinceMs }, transitions }
}

const PHASE_HOPS = 6 // idle→pending→active→clearing→cooldown→idle is the longest chain

// ---------- event stats ----------

export function initStats(value: number): EventStats {
  return { count: 1, min: value, max: value, sum: value, last: value }
}

export function accumulateStats(stats: EventStats, value: number): EventStats {
  return {
    count: stats.count + 1,
    min: Math.min(stats.min, value),
    max: Math.max(stats.max, value),
    sum: stats.sum + value,
    last: value,
  }
}
