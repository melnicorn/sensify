import { describe, it, expect } from 'vitest'
import { isValidTopicFilter, parseMqttPayload, parseAvailability } from './mqtt-topic'

describe('isValidTopicFilter', () => {
  it('accepts concrete topics and well-formed wildcards', () => {
    for (const f of ['#', 'a/#', 'a/+/b', '+/b', 'sensify/readings/esp32-48f6eefffec7', 'a']) {
      expect(isValidTopicFilter(f), f).toBe(true)
    }
  })

  it('rejects malformed wildcards, empty input and whitespace', () => {
    // '#' must stand alone as the final level; '+' must be a whole level
    for (const f of ['a/#/b', 'a#', 'a+b', '#/a', '', 'a b']) {
      expect(isValidTopicFilter(f), f).toBe(false)
    }
  })

  it('keeps hyphens, dots and colons valid (they are common in topics)', () => {
    expect(isValidTopicFilter('shellyplugusg4-abc/status/switch:0')).toBe(true)
  })
})

describe('parseMqttPayload', () => {
  it('parses JSON', () => {
    expect(parseMqttPayload('{"a":1}')).toEqual({ payload: { a: 1 }, isJson: true })
  })

  it('falls back to the raw string when not JSON', () => {
    expect(parseMqttPayload('online')).toEqual({ payload: 'online', isJson: false })
  })
})

describe('parseAvailability', () => {
  it('reads the LWT convention', () => {
    expect(parseAvailability('online')).toBe(true)
    expect(parseAvailability('offline')).toBe(false)
  })

  it('reads booleans (e.g. Shelly) and 1/0', () => {
    expect(parseAvailability('true')).toBe(true)
    expect(parseAvailability('false')).toBe(false)
    expect(parseAvailability('1')).toBe(true)
    expect(parseAvailability('0')).toBe(false)
  })

  it('tolerates case, whitespace and JSON-quoted strings', () => {
    expect(parseAvailability('  ONLINE\n')).toBe(true)
    expect(parseAvailability('"offline"')).toBe(false)
  })

  it('returns null for anything it does not recognize, rather than guessing', () => {
    expect(parseAvailability('banana')).toBeNull()
    expect(parseAvailability('')).toBeNull()
    expect(parseAvailability('{"state":"online"}')).toBeNull()
  })
})
