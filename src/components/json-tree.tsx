'use client'

// Recursive JSON tree with optional field selection. Shared by the pull-device
// wizard (HTTP payloads) and the MQTT topic browser (broker payloads) — a
// reading is a reading regardless of transport, so the field-picking UX is too.
//
// Pass `selected` + `onToggle` to make capturable leaves (numbers/booleans)
// selectable via checkboxes; omit them to render read-only (browse mode).
import { joinPath } from '@/lib/json-path'

function isCapturableLeaf(v: unknown): boolean {
  return (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean'
}

interface JsonTreeProps {
  value: unknown
  /** Selected field paths. Omit for read-only browse mode. */
  selected?: Set<string>
  /** Toggle a field path. Omit for read-only browse mode. */
  onToggle?: (path: string) => void
}

export function JsonTree({ value, selected, onToggle }: JsonTreeProps) {
  return (
    <JsonNode value={value} path="" label={null} selected={selected} onToggle={onToggle} />
  )
}

function JsonNode({
  value,
  path,
  label,
  selected,
  onToggle,
}: {
  value: unknown
  path: string
  label: string | null
  selected?: Set<string>
  onToggle?: (path: string) => void
}) {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [i, v] as const)
      : Object.entries(value)
    return (
      <div>
        {label !== null && (
          <div className="text-muted-foreground">
            {label} <span className="opacity-60">{Array.isArray(value) ? '[ ]' : '{ }'}</span>
          </div>
        )}
        <div className={label !== null ? 'pl-5 border-l border-border/50 ml-1' : ''}>
          {entries.map(([key, child]) => (
            <JsonNode
              key={String(key)}
              value={child}
              path={joinPath(path, key)}
              label={typeof key === 'number' ? `[${key}]` : key}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </div>
      </div>
    )
  }

  const capturable = isCapturableLeaf(value)
  const display = JSON.stringify(value)

  // Read-only, or a non-capturable leaf (string/null): plain line, no checkbox.
  if (!capturable || !onToggle) {
    return (
      <div className={capturable ? 'text-foreground' : 'text-muted-foreground/60'}>
        <span className="inline-block w-5" />
        {label}: <span className="text-muted-foreground">{display}</span>
      </div>
    )
  }

  return (
    <label className="flex items-center gap-1.5 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1">
      <input
        type="checkbox"
        checked={selected?.has(path) ?? false}
        onChange={() => onToggle(path)}
        className="accent-[var(--color-primary,currentColor)]"
      />
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">: {display}</span>
    </label>
  )
}
