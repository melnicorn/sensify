'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { Plug, Check, X, Trash2 } from 'lucide-react'
import {
  testPullAction,
  createPullDeviceAction,
  updatePullDeviceAction,
  type TestPullResult,
} from '@/app/actions'
import { joinPath } from '@/lib/json-path'
import type { PullField } from '@/lib/types'

interface Props {
  mode: 'create' | 'edit'
  sensorId?: string
  initial?: {
    name: string
    url: string
    pollInterval: number
    fields: PullField[]
    lastSample?: string | null
  }
}

function defaultMetricName(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .join('_')
}

function parseSample(sample: string | null | undefined): unknown {
  if (!sample) return undefined
  try {
    return JSON.parse(sample)
  } catch {
    return undefined
  }
}

export function PullDeviceWizard({ mode, sensorId, initial }: Props) {
  const router = useRouter()
  const [url, setUrl] = useState(initial?.url ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [pollInterval, setPollInterval] = useState(initial?.pollInterval ?? 60)
  const [fields, setFields] = useState<PullField[]>(initial?.fields ?? [])
  const [sample, setSample] = useState<unknown>(parseSample(initial?.lastSample))
  const [test, setTest] = useState<TestPullResult | null>(null)
  const [testing, startTest] = useTransition()
  const [saving, startSave] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)

  const tree = test?.ok ? test.body : sample

  function runTest() {
    startTest(async () => {
      const result = await testPullAction(url)
      setTest(result)
      if (result.ok) setSample(result.body)
    })
  }

  function toggleField(path: string) {
    setFields((prev) => {
      const existing = prev.find((f) => f.path === path)
      if (existing) return prev.filter((f) => f.path !== path)
      return [...prev, { path, metric: defaultMetricName(path) }]
    })
  }

  function updateField(path: string, patch: Partial<PullField>) {
    setFields((prev) => prev.map((f) => (f.path === path ? { ...f, ...patch } : f)))
  }

  function save() {
    setSaveError(null)
    const payload = {
      name: name.trim(),
      url: url.trim(),
      pollInterval,
      fields: fields.map((f) => ({
        path: f.path,
        metric: f.metric.trim(),
        unit: f.unit?.trim() || undefined,
      })),
      sample: sample ?? undefined,
    }
    startSave(async () => {
      const result =
        mode === 'create'
          ? await createPullDeviceAction(payload)
          : await updatePullDeviceAction(sensorId!, payload)
      if (result.error) {
        setSaveError(result.error)
      } else {
        router.push(`/sensors/${result.id}`)
      }
    })
  }

  const duplicateMetrics = new Set(
    fields.map((f) => f.metric.trim()).filter((m, i, arr) => arr.indexOf(m) !== i)
  )
  const canSave =
    name.trim() !== '' &&
    url.trim() !== '' &&
    fields.length > 0 &&
    fields.every((f) => f.metric.trim() !== '') &&
    duplicateMetrics.size === 0 &&
    pollInterval >= 2 &&
    pollInterval <= 86400

  const inputClass =
    'rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'

  return (
    <div className="space-y-4">
      {/* Endpoint */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-medium text-foreground">Endpoint</h2>
        <p className="text-xs text-muted-foreground">
          URL that returns a JSON document when fetched with GET. No authentication is sent.
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.50/status"
            className={`flex-1 font-mono text-xs ${inputClass}`}
          />
          <Button size="sm" onPress={runTest} isDisabled={testing || url.trim() === ''}>
            <Plug size={14} />
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
        </div>
        {test && (
          <p
            className={`flex items-center gap-1 text-xs ${
              test.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'
            }`}
          >
            {test.ok ? <Check size={13} /> : <X size={13} />}
            {test.ok
              ? `HTTP ${test.status} · valid JSON · ${test.latencyMs} ms`
              : test.error}
          </p>
        )}
      </section>

      {/* Field selection */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Fields to record</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Numeric and boolean values can be recorded. Booleans are stored as 0/1.
          </p>
        </div>
        {tree !== undefined ? (
          <div className="rounded-md border border-border bg-background/50 p-3 font-mono text-xs leading-7 overflow-x-auto">
            <JsonNode
              value={tree}
              path=""
              label={null}
              selected={new Set(fields.map((f) => f.path))}
              onToggle={toggleField}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Test the connection to load the device&apos;s JSON structure.
          </p>
        )}

        {fields.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Selected fields</h3>
            {fields.map((f) => (
              <div key={f.path} className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
                  {f.path}
                </code>
                <input
                  type="text"
                  value={f.metric}
                  onChange={(e) => updateField(f.path, { metric: e.target.value })}
                  placeholder="metric_name"
                  aria-label={`Metric name for ${f.path}`}
                  className={`w-40 font-mono text-xs ${inputClass} ${
                    duplicateMetrics.has(f.metric.trim()) || f.metric.trim() === ''
                      ? 'border-destructive'
                      : ''
                  }`}
                />
                <input
                  type="text"
                  value={f.unit ?? ''}
                  onChange={(e) => updateField(f.path, { unit: e.target.value })}
                  placeholder="unit"
                  aria-label={`Unit for ${f.path}`}
                  className={`w-16 text-xs ${inputClass}`}
                />
                <button
                  type="button"
                  onClick={() => toggleField(f.path)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Remove ${f.path}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {duplicateMetrics.size > 0 && (
              <p className="text-xs text-destructive">Metric names must be unique.</p>
            )}
          </div>
        )}
      </section>

      {/* Settings */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium text-foreground">Device settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label htmlFor="device-name" className="text-xs text-muted-foreground">
              Device name
            </label>
            <input
              id="device-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Washer plug"
              className={`w-full ${inputClass}`}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="poll-interval" className="text-xs text-muted-foreground">
              Poll every (seconds)
            </label>
            <input
              id="poll-interval"
              type="number"
              min={2}
              max={86400}
              value={pollInterval}
              onChange={(e) => setPollInterval(parseInt(e.target.value, 10) || 0)}
              className={`w-full ${inputClass}`}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        {saveError && <span className="text-sm text-destructive mr-auto">{saveError}</span>}
        <Button size="sm" variant="ghost" onPress={() => router.back()}>
          Cancel
        </Button>
        <Button size="sm" onPress={save} isDisabled={!canSave || saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Add device' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

// ---------- JSON tree ----------

function isCapturableLeaf(v: unknown): boolean {
  return (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean'
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
  selected: Set<string>
  onToggle: (path: string) => void
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
  if (!capturable) {
    return (
      <div className="text-muted-foreground/60">
        <span className="inline-block w-5" />
        {label}: {display}
      </div>
    )
  }
  return (
    <label className="flex items-center gap-1.5 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1">
      <input
        type="checkbox"
        checked={selected.has(path)}
        onChange={() => onToggle(path)}
        className="accent-[var(--color-primary,currentColor)]"
      />
      <span className="text-foreground">{label}</span>
      <span className="text-muted-foreground">: {display}</span>
    </label>
  )
}
