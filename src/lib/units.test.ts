import { describe, it, expect } from 'vitest'
import { parseUnitLabel, toCanonicalValue, convertTemperature } from './units'

describe('parseUnitLabel', () => {
  it('recognizes temperature aliases in many spellings', () => {
    for (const label of ['C', 'c', '°C', 'degC', 'deg C', 'celsius', 'Celsius', 'degrees C']) {
      expect(parseUnitLabel(label), label).toEqual({ kind: 'temperature', unit: 'C' })
    }
    for (const label of ['F', '°F', 'degF', 'fahrenheit', 'DEG F']) {
      expect(parseUnitLabel(label), label).toEqual({ kind: 'temperature', unit: 'F' })
    }
    for (const label of ['K', 'kelvin', 'degK']) {
      expect(parseUnitLabel(label), label).toEqual({ kind: 'temperature', unit: 'K' })
    }
  })

  it('treats everything else as a plain display label', () => {
    for (const label of ['W', 'Wh', 'kWh', '%', 'lux', 'hPa', '', undefined, null]) {
      expect(parseUnitLabel(label), String(label)).toBeNull()
    }
  })
})

describe('toCanonicalValue', () => {
  it('converts recognized temperatures to °C', () => {
    expect(toCanonicalValue(212, 'degF')).toBeCloseTo(100)
    expect(toCanonicalValue(273.15, 'K')).toBeCloseTo(0)
    expect(toCanonicalValue(21.5, '°C')).toBe(21.5)
  })

  it('passes through unrecognized units untouched', () => {
    expect(toCanonicalValue(42, 'W')).toBe(42)
    expect(toCanonicalValue(42, undefined)).toBe(42)
  })
})

describe('convertTemperature', () => {
  it('round-trips through every unit', () => {
    for (const from of ['C', 'F', 'K'] as const) {
      for (const to of ['C', 'F', 'K'] as const) {
        expect(convertTemperature(convertTemperature(37, from, to), to, from)).toBeCloseTo(37)
      }
    }
  })

  it('hits known anchors', () => {
    expect(convertTemperature(0, 'C', 'F')).toBe(32)
    expect(convertTemperature(100, 'C', 'K')).toBeCloseTo(373.15)
  })
})
