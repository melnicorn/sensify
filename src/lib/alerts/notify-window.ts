// Pure delivery-window math. Client-safe (no database imports) — shared by
// the engine (suppression at send time) and the UI (summaries, wizard).
import type { NotifyWindow } from './schemas'

/** Whether `hour` (0–23) falls inside [fromH, toH), wrapping past midnight
 *  when toH <= fromH. fromH === toH covers the full day. */
export function hourInSpan(fromH: number, toH: number, hour: number): boolean {
  if (fromH === toH) return true
  if (fromH < toH) return hour >= fromH && hour < toH
  return hour >= fromH || hour < toH
}

/** Whether a notification should be delivered at `date` under `window`
 *  (absent window = always). Hours use the process's local timezone. */
export function shouldNotifyAt(window: NotifyWindow | undefined, date: Date): boolean {
  if (!window) return true
  const inside = hourInSpan(window.fromH, window.toH, date.getHours())
  return window.mode === 'allow' ? inside : !inside
}

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}
