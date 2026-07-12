// Chart time ranges, shared by the server page (initial render), the client
// range switcher, and the readings server action.
export const RANGES: Record<string, { label: string; hours: number }> = {
  '1h': { label: '1 hour', hours: 1 },
  '24h': { label: '24 hours', hours: 24 },
  '7d': { label: '7 days', hours: 24 * 7 },
  '30d': { label: '30 days', hours: 24 * 30 },
}

export const DEFAULT_RANGE = '7d'

export function rangeHours(range: string): number {
  return (RANGES[range] ?? RANGES[DEFAULT_RANGE]!).hours
}
