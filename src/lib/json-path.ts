// Dot/bracket paths into arbitrary JSON, e.g. "aenergy.total", "[0].apower",
// "channels[2].power". Shared by the device wizard (browser) and the poller.

export function parsePath(path: string): (string | number)[] {
  const tokens: (string | number)[] = []
  const re = /([^.[\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) tokens.push(match[1])
    else tokens.push(parseInt(match[2]!, 10))
  }
  return tokens
}

export function getAtPath(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const token of parsePath(path)) {
    if (current === null || current === undefined) return undefined
    if (typeof token === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[token]
    } else {
      if (typeof current !== 'object' || Array.isArray(current)) return undefined
      current = (current as Record<string, unknown>)[token]
    }
  }
  return current
}

/** Can this leaf value be recorded as a metric? Numbers and booleans only. */
export function isCapturable(value: unknown): value is number | boolean {
  return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
}

/** Numeric value for storage: booleans become 0/1. */
export function toMetricValue(value: number | boolean): number {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value
}

/** Append a key or array index to a path string. */
export function joinPath(parent: string, segment: string | number): string {
  if (typeof segment === 'number') return `${parent}[${segment}]`
  return parent ? `${parent}.${segment}` : segment
}
