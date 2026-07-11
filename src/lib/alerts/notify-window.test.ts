import { describe, it, expect } from 'vitest'
import { hourInSpan, shouldNotifyAt } from './notify-window'
import type { NotifyWindow } from './schemas'

function at(hour: number): Date {
  const d = new Date(2026, 6, 11) // local midnight
  d.setHours(hour, 30)
  return d
}

describe('hourInSpan', () => {
  it('handles a plain daytime span [from, to)', () => {
    expect(hourInSpan(8, 22, 8)).toBe(true)
    expect(hourInSpan(8, 22, 21)).toBe(true)
    expect(hourInSpan(8, 22, 22)).toBe(false) // exclusive end
    expect(hourInSpan(8, 22, 7)).toBe(false)
  })

  it('wraps past midnight when to <= from', () => {
    expect(hourInSpan(22, 7, 23)).toBe(true)
    expect(hourInSpan(22, 7, 3)).toBe(true)
    expect(hourInSpan(22, 7, 7)).toBe(false) // exclusive end
    expect(hourInSpan(22, 7, 12)).toBe(false)
  })

  it('treats from === to as the full day', () => {
    expect(hourInSpan(9, 9, 9)).toBe(true)
    expect(hourInSpan(9, 9, 0)).toBe(true)
  })
})

describe('shouldNotifyAt', () => {
  const allow: NotifyWindow = { mode: 'allow', fromH: 8, toH: 22 }
  const block: NotifyWindow = { mode: 'block', fromH: 22, toH: 7 }

  it('always notifies without a window', () => {
    expect(shouldNotifyAt(undefined, at(3))).toBe(true)
  })

  it('allow mode sends only inside the span', () => {
    expect(shouldNotifyAt(allow, at(12))).toBe(true)
    expect(shouldNotifyAt(allow, at(23))).toBe(false)
  })

  it('block mode mutes inside the span', () => {
    expect(shouldNotifyAt(block, at(23))).toBe(false)
    expect(shouldNotifyAt(block, at(3))).toBe(false)
    expect(shouldNotifyAt(block, at(12))).toBe(true)
  })
})
