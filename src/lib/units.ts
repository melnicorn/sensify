// ---------- unit registry ----------
// Pull-device field units arrive as free text ("degC", "°F", "Wh"). Labels
// that resolve to a known dimension get canonical treatment: temperature
// readings are stored in °C and converted to the display preference, exactly
// like push sensors. Unrecognized labels remain display-only text.

const TEMPERATURE_ALIASES: Record<string, 'C' | 'F' | 'K'> = {
  c: 'C',
  degc: 'C',
  celsius: 'C',
  f: 'F',
  degf: 'F',
  fahrenheit: 'F',
  k: 'K',
  degk: 'K',
  kelvin: 'K',
}

export interface ParsedUnit {
  kind: 'temperature'
  unit: 'C' | 'F' | 'K'
}

/** Resolve a free-text unit label to a known dimension, or null if it is
 *  just a display label (W, Wh, %, lux, …). */
export function parseUnitLabel(label?: string | null): ParsedUnit | null {
  if (!label) return null
  const norm = label
    .trim()
    .toLowerCase()
    .replace(/°/g, '')
    .replace(/degrees?/g, 'deg')
    .replace(/\s+/g, '')
  const temp = TEMPERATURE_ALIASES[norm]
  return temp ? { kind: 'temperature', unit: temp } : null
}

/** Convert a raw device value to canonical storage units based on its field's
 *  unit label: temperatures become °C, everything else passes through. */
export function toCanonicalValue(value: number, unitLabel?: string | null): number {
  const parsed = parseUnitLabel(unitLabel)
  if (parsed?.kind === 'temperature') return convertTemperature(value, parsed.unit, 'C')
  return value
}

export function convertTemperature(value: number, from: 'C' | 'F' | 'K', to: 'C' | 'F' | 'K'): number {
  if (from === to) return value
  // Convert to Celsius first
  let c: number
  if (from === 'F') c = (value - 32) * (5 / 9)
  else if (from === 'K') c = value - 273.15
  else c = value
  // Then to target
  if (to === 'F') return c * (9 / 5) + 32
  if (to === 'K') return c + 273.15
  return c
}

export function formatTemperature(
  value: number,
  fromUnit: 'C' | 'F' | 'K',
  displayUnit: 'C' | 'F' | 'K'
): string {
  const converted = convertTemperature(value, fromUnit, displayUnit)
  return `${converted.toFixed(1)}°${displayUnit}`
}

export function formatHumidity(value: number): string {
  return `${value.toFixed(1)}%`
}

/** Compact numeric display: integers stay whole, decimals get one place. */
export function formatMetricValue(value: number, unit?: string): string {
  const num = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return unit ? `${num} ${unit}` : num
}

/** Human label for a metric name, e.g. "energy_total" → "Energy total". */
export function metricLabel(metric: string): string {
  const words = metric.replace(/[_.-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
