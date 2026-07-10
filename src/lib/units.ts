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
