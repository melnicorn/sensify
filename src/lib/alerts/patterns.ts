// Pattern-based rule derivation: pick a standard time-series shape and derive
// level-rule parameters from the sensor's own history using robust statistics
// (median + k·MAD). Robust matters: events contaminate mean/stddev — on the
// captured washer data mean+3σ lands at ~226 W while median+4·MAD lands at
// ~5.5 W, squarely between standby and the gentlest cycle. Pure functions, no
// database access; parameters are materialized into ordinary level rules at
// creation time (recalibrate by re-deriving, never by a moving baseline).
import type { SignalPoint } from './machine'
import type { LevelTrigger } from './schemas'

export type PatternId = 'pulse' | 'spike' | 'dip' | 'rise-hold' | 'fall-hold'

/** How easily the alert fires: high = small deviations (k=2), low = only
 *  extreme ones (k=6). */
export type Sensitivity = 'high' | 'medium' | 'low'

export interface PatternSpec {
  id: PatternId
  label: string
  blurb: string
  direction: 'above' | 'below'
  /** Whether the pattern wants an end notification (level shifts do not). */
  notifyEnd: boolean
}

export const PATTERNS: PatternSpec[] = [
  {
    id: 'pulse',
    label: 'Cycle / pulse',
    blurb: 'Turns on, runs, turns off. Notifies at start and finish.',
    direction: 'above',
    notifyEnd: true,
  },
  {
    id: 'spike',
    label: 'Spike above normal',
    blurb: 'Rises unusually far above its typical range.',
    direction: 'above',
    notifyEnd: true,
  },
  {
    id: 'dip',
    label: 'Dip below normal',
    blurb: 'Falls unusually far below its typical range.',
    direction: 'below',
    notifyEnd: true,
  },
  {
    id: 'rise-hold',
    label: 'Rises and stays',
    blurb: 'Level shift up. Notifies once when it settles high.',
    direction: 'above',
    notifyEnd: false,
  },
  {
    id: 'fall-hold',
    label: 'Falls and stays',
    blurb: 'Level shift down — e.g. a device that switched off.',
    direction: 'below',
    notifyEnd: false,
  },
]

const K: Record<Sensitivity, number> = { high: 2, medium: 4, low: 6 }

const MIN_POINTS = 20

export interface PatternDerivation {
  trigger: LevelTrigger
  cooldownS: number
  notifyEnd: boolean
  diagnostics: { median: number; mad: number; threshold: number; k: number }
}

export interface PatternError {
  error: string
}

function median(sorted: number[]): number {
  return sorted[Math.floor((sorted.length - 1) / 2)]!
}

function sig3(n: number): number {
  return n === 0 ? 0 : Number(n.toPrecision(3))
}

export function derivePatternRule(
  points: SignalPoint[],
  pattern: PatternId,
  sensitivity: Sensitivity,
  metric: string
): PatternDerivation | PatternError {
  const spec = PATTERNS.find((p) => p.id === pattern)
  if (!spec) return { error: `Unknown pattern ${pattern}` }
  if (points.length < MIN_POINTS) {
    return { error: 'Not enough history to derive thresholds — let the sensor collect data first' }
  }

  const values = points.map((p) => p.value).sort((a, b) => a - b)
  const med = median(values)
  const mad = median(values.map((v) => Math.abs(v - med)).sort((a, b) => a - b))
  // A dead-flat baseline has MAD 0; floor the spread so k·MAD stays meaningful
  const spread = Math.max(mad, 0.005 * Math.max(Math.abs(med), 1))
  const k = K[sensitivity]

  const above = spec.direction === 'above'
  const threshold = sig3(above ? med + k * spread : med - k * spread)
  const startOp = above ? ('>' as const) : ('<' as const)
  const endOp = above ? ('<=' as const) : ('>=' as const)

  // Median sampling interval scales the dwell defaults
  const tail = points.slice(-100)
  const gaps = tail
    .slice(1)
    .map((p, i) => (p.tsMs - tail[i]!.tsMs) / 1000)
    .filter((g) => g > 0)
    .sort((a, b) => a - b)
  const sampleS = gaps.length ? median(gaps) : 30

  const holdFloor = (min: number) => Math.max(min, Math.ceil((2 * sampleS) / 30) * 30)

  switch (spec.id) {
    case 'pulse':
      // Appliance-style: modest smoothing, quick start, patient end (interior
      // dips between phases shouldn't split one run into many events)
      return {
        trigger: {
          kind: 'level',
          metric,
          signal: { agg: 'avg', windowS: 60 },
          start: { op: startOp, value: threshold, holdS: holdFloor(60) },
          end: { op: endOp, value: threshold, holdS: 180 },
        },
        cooldownS: 300,
        notifyEnd: true,
        diagnostics: { median: med, mad, threshold, k },
      }
    case 'spike':
    case 'dip': {
      // Environmental-style: heavy smoothing, sustained crossing, and value
      // hysteresis — the event ends one sensitivity notch back toward normal
      const endValue = sig3(above ? med + (k - 1) * spread : med - (k - 1) * spread)
      return {
        trigger: {
          kind: 'level',
          metric,
          signal: { agg: 'avg', windowS: 300 },
          start: { op: startOp, value: threshold, holdS: holdFloor(300) },
          end: { op: endOp, value: endValue, holdS: 600 },
        },
        cooldownS: 1800,
        notifyEnd: true,
        diagnostics: { median: med, mad, threshold, k },
      }
    }
    case 'rise-hold':
    case 'fall-hold':
      // Level shift: must persist before firing; the end just re-arms quietly
      return {
        trigger: {
          kind: 'level',
          metric,
          signal: { agg: 'avg', windowS: 120 },
          start: { op: startOp, value: threshold, holdS: holdFloor(300) },
          end: { op: endOp, value: threshold, holdS: 600 },
        },
        cooldownS: 3600,
        notifyEnd: false,
        diagnostics: { median: med, mad, threshold, k },
      }
  }
}
