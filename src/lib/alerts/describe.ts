// Human-readable rule summaries. Client-safe (no database imports).
import type { RuleDefinition } from './schemas'
import { hourLabel } from './notify-window'
import { metricLabel } from '../units'

function secondsLabel(s: number): string {
  return s % 60 === 0 && s >= 60 ? `${s / 60}min` : `${s}s`
}

function windowLabel(windowS: number): string {
  if (windowS <= 0) return 'each reading'
  return `${secondsLabel(windowS)} avg`
}

function holdLabel(holdS: number): string {
  if (holdS <= 0) return ''
  return ` for ${secondsLabel(holdS)}`
}

export function describeRule(def: RuleDefinition): string {
  const t = def.trigger
  const agg = t.signal.agg === 'avg' ? windowLabel(t.signal.windowS) : `${t.signal.agg} ${windowLabel(t.signal.windowS)}`
  const start = `${metricLabel(t.metric)} (${agg}) ${t.start.op} ${t.start.value}${holdLabel(t.start.holdS)}`
  const end = t.end ? `, ends ${t.end.op} ${t.end.value}${holdLabel(t.end.holdS)}` : ''
  const w = def.notifyWindow
  const window = w
    ? ` · ${w.mode === 'allow' ? 'notifies' : 'muted'} ${hourLabel(w.fromH)}–${hourLabel(w.toH)}`
    : ''
  return `${start}${end}${window}`
}
