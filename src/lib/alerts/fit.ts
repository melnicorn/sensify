// Fit a level rule from an example event (a user's chart drag) and backtest
// rule definitions against history. Pure functions over the machine core —
// no database access — so the wizard, server actions, and tests share them.
import { computeSignal, stepMachine, defaultEnd, conditionMet, type MachineState, type SignalPoint } from './machine'
import type { LevelTrigger, RuleDefinition } from './schemas'

// ---------- fitting ----------

export interface FitResult {
  trigger: LevelTrigger
  cooldownS: number
  diagnostics: {
    direction: 'above' | 'below'
    baselineLevel: number // the busy tail of the baseline (p95 / p05)
    activeLevel: number // the quiet tail of the selection (p10 / p90)
  }
}

export interface FitError {
  error: string
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[idx]!
}

function roundNice(n: number): number {
  if (n === 0) return 0
  const mag = 10 ** Math.floor(Math.log10(Math.abs(n)))
  return Math.round((n / mag) * 2) / 2 * mag // 1.5 significant-ish digits
}

const WINDOW_LADDER_S = [0, 30, 60, 120, 180, 300]
const HOLD_LADDER_S = [30, 60, 90, 120, 180, 300, 600]

function roundUpLadder(s: number, ladder: number[]): number {
  for (const step of ladder) if (s <= step) return step
  return ladder[ladder.length - 1]!
}

/** Fit level-rule parameters from a dragged example event. `points` should
 *  cover the selection plus surrounding baseline (the caller passes the
 *  chart's loaded range). Values are canonical units, matching storage. */
export function fitLevelRule(
  points: SignalPoint[],
  selection: { fromMs: number; toMs: number },
  metric: string
): FitResult | FitError {
  const inSel = points.filter((p) => p.tsMs >= selection.fromMs && p.tsMs <= selection.toMs)
  const baseline = points.filter((p) => p.tsMs < selection.fromMs || p.tsMs > selection.toMs)
  if (inSel.length < 3) return { error: 'Selection contains too few readings to fit a rule' }
  if (baseline.length < 3)
    return { error: 'Not enough readings around the selection to establish a baseline' }

  const selSorted = inSel.map((p) => p.value).sort((a, b) => a - b)
  const baseSorted = baseline.map((p) => p.value).sort((a, b) => a - b)
  const selMedian = percentile(selSorted, 0.5)
  const baseMedian = percentile(baseSorted, 0.5)

  const direction: 'above' | 'below' = selMedian >= baseMedian ? 'above' : 'below'
  // The busy tail of the baseline: the threshold must sit above (below) it
  const baselineLevel =
    direction === 'above' ? percentile(baseSorted, 0.95) : percentile(baseSorted, 0.05)

  // Drags are sloppy: trim leading/trailing samples that still look like
  // baseline so padding inside the selection can't poison the percentiles.
  // Interior dips are kept — they inform the smoothing window and end dwell.
  const isBaselineLike = (v: number) =>
    direction === 'above' ? v <= baselineLevel : v >= baselineLevel
  let coreFrom = 0
  while (coreFrom < inSel.length && isBaselineLike(inSel[coreFrom]!.value)) coreFrom++
  let coreTo = inSel.length - 1
  while (coreTo >= coreFrom && isBaselineLike(inSel[coreTo]!.value)) coreTo--
  const trimmed = inSel.slice(coreFrom, coreTo + 1)
  if (trimmed.length < 3) {
    return {
      error:
        'The selected period does not stand out from its surroundings — try selecting one clear event with some quiet time around it',
    }
  }
  const trimmedSorted = trimmed.map((p) => p.value).sort((a, b) => a - b)
  const activeLevel =
    direction === 'above' ? percentile(trimmedSorted, 0.1) : percentile(trimmedSorted, 0.9)

  const gap = direction === 'above' ? activeLevel - baselineLevel : baselineLevel - activeLevel
  if (!(gap > 0)) {
    return {
      error:
        'The selected period does not stand out from its surroundings — try selecting one clear event with some quiet time around it',
    }
  }

  // Bias toward the baseline end so gentler variants of the event still trip
  const raw =
    direction === 'above' ? baselineLevel + 0.35 * gap : baselineLevel - 0.35 * gap
  let threshold = roundNice(raw)
  // Nice-rounding must not push the threshold out of the separating gap
  if (direction === 'above' && (threshold <= baselineLevel || threshold >= activeLevel)) threshold = raw
  if (direction === 'below' && (threshold >= baselineLevel || threshold <= activeLevel)) threshold = raw

  const op = direction === 'above' ? ('>' as const) : ('<' as const)
  const startCond = { op, value: threshold, holdS: 0 }

  // Median sampling interval informs the dwell defaults
  const intervals = trimmed
    .slice(1)
    .map((p, i) => (p.tsMs - trimmed[i]!.tsMs) / 1000)
    .sort((a, b) => a - b)
  const sampleS = percentile(intervals, 0.5) || 30

  // Narrow further to the span that actually crosses the fitted threshold
  const firstTrip = trimmed.findIndex((p) => conditionMet(startCond, p.value))
  let lastTrip = -1
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (conditionMet(startCond, trimmed[i]!.value)) {
      lastTrip = i
      break
    }
  }
  if (firstTrip === -1) return { error: 'No readings in the selection cross the fitted threshold' }
  const core = trimmed.slice(firstTrip, lastTrip + 1)

  // Smoothing window: smallest ladder step whose time-weighted average never
  // crosses back over the threshold inside the event core
  let windowS = WINDOW_LADDER_S[WINDOW_LADDER_S.length - 1]!
  for (const candidate of WINDOW_LADDER_S) {
    let ok = true
    for (const p of core) {
      if (p.tsMs - core[0]!.tsMs < candidate * 1000) continue // window still filling
      const signal = computeSignal(core, 'avg', candidate, p.tsMs)
      if (signal === null || !conditionMet(startCond, signal)) {
        ok = false
        break
      }
    }
    if (ok) {
      windowS = candidate
      break
    }
  }

  // Longest interior raw excursion across the threshold sets the end dwell
  let longestDipS = 0
  let dipStart: number | null = null
  for (const p of core) {
    if (!conditionMet(startCond, p.value)) {
      dipStart ??= p.tsMs
      longestDipS = Math.max(longestDipS, (p.tsMs - dipStart) / 1000 + sampleS)
    } else {
      dipStart = null
    }
  }

  const startHoldS = roundUpLadder(Math.max(30, 2 * sampleS), HOLD_LADDER_S)
  const endHoldS = roundUpLadder(Math.max(90, 3 * sampleS, 1.5 * longestDipS), HOLD_LADDER_S)

  return {
    trigger: {
      kind: 'level',
      metric,
      signal: { agg: 'avg', windowS },
      start: { op, value: threshold, holdS: startHoldS },
      end: { op: defaultEnd(startCond).op, value: threshold, holdS: endHoldS },
    },
    cooldownS: 300,
    diagnostics: { direction, baselineLevel, activeLevel },
  }
}

// ---------- backtest ----------

export interface BacktestEvent {
  startMs: number
  endMs: number | null // null = still open at the end of history
  min: number
  max: number
  avg: number
  count: number
}

/** Replay a rule over history using the exact live-engine core. */
export function backtestRule(def: RuleDefinition, points: SignalPoint[]): BacktestEvent[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => a.tsMs - b.tsMs)
  const windowMs = Math.max(def.trigger.signal.windowS, 0) * 1000

  const events: BacktestEvent[] = []
  let state: MachineState = { phase: 'idle', phaseSinceMs: sorted[0]!.tsMs }
  let open: BacktestEvent | null = null
  let startIdx = 0

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i]!
    // Sliding window: keep one sample before the window start (its value is
    // in effect at the boundary), so computeSignal sees only relevant points
    while (startIdx + 1 < i && sorted[startIdx + 1]!.tsMs <= p.tsMs - windowMs) startIdx++
    const slice = sorted.slice(startIdx, i + 1)
    const signal = computeSignal(slice, def.trigger.signal.agg, def.trigger.signal.windowS, p.tsMs)
    const result = stepMachine(def, state, signal, p.tsMs)
    state = result.state

    for (const t of result.transitions) {
      if (t.type === 'start') {
        open = { startMs: t.atMs, endMs: null, min: p.value, max: p.value, avg: p.value, count: 0 }
        events.push(open)
      } else if (open) {
        open.endMs = t.atMs
        open = null
      }
    }
    if (open) {
      open.min = Math.min(open.min, p.value)
      open.max = Math.max(open.max, p.value)
      open.avg = (open.avg * open.count + p.value) / (open.count + 1)
      open.count++
    }
  }
  return events
}
