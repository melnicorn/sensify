'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { Radio, Square, X, Trash2, Copy, Check } from 'lucide-react'
import { JsonTree } from '@/components/json-tree'
import {
  createMqttSensorAction,
  convertSensorToMqttAction,
  updateMqttSensorAction,
} from '@/app/actions'
import { getAtPath, isCapturable } from '@/lib/json-path'
import { parseMqttPayload, type MqttBrowseMessage } from '@/lib/mqtt-topic'
import type { PullField } from '@/lib/types'

const inputClass =
  'rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'

type StreamEvent =
  | ({ type: 'message' } & MqttBrowseMessage)
  | { type: 'ready'; filter: string }
  | { type: 'error'; error: string }

function defaultMetricName(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .join('_')
}

interface Props {
  /**
   * 'convert' moves an existing pull/push sensor onto MQTT in place;
   * 'edit' changes an existing MQTT sensor's topics and field mappings.
   */
  mode?: 'create' | 'convert' | 'edit'
  sensorId?: string
  initialName?: string
  /** Current field mappings — re-ticked automatically when their paths resolve. */
  existingFields?: PullField[]
  /** Metric names this sensor already has readings for (push sensors have no field mappings). */
  existingMetrics?: string[]
  /** Edit mode: the sensor's current topics, so nothing is silently cleared on save. */
  initialTopic?: string
  initialAvailabilityTopic?: string | null
  initialConfigTopic?: string | null
  /** Edit mode: last payload seen, so the tree renders without waiting for a publish. */
  initialSample?: string | null
}

export function MqttTopicBrowser({
  mode = 'create',
  sensorId,
  initialName,
  existingFields,
  existingMetrics,
  initialTopic,
  initialAvailabilityTopic,
  initialConfigTopic,
  initialSample,
}: Props = {}) {
  const router = useRouter()
  const [filter, setFilter] = useState(mode === 'edit' && initialTopic ? initialTopic : '#')
  const [running, setRunning] = useState(false)
  // Editing starts from the stored payload so the tree is usable immediately;
  // Listen then refreshes it from live traffic.
  const [messages, setMessages] = useState<Record<string, MqttBrowseMessage>>(() => {
    if (mode !== 'edit' || !initialTopic || !initialSample) return {}
    const { payload, isJson } = parseMqttPayload(initialSample)
    return {
      [initialTopic]: { topic: initialTopic, retain: false, payload, raw: initialSample, isJson },
    }
  })
  const [selectedTopic, setSelectedTopic] = useState<string | null>(
    mode === 'edit' ? (initialTopic ?? null) : null
  )
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // Field selection + sensor details for the currently selected topic.
  const [fields, setFields] = useState<PullField[]>(mode === 'edit' ? (existingFields ?? []) : [])
  const [name, setName] = useState(initialName ?? '')
  const [availabilityTopic, setAvailabilityTopic] = useState(initialAvailabilityTopic ?? '')
  const [configTopic, setConfigTopic] = useState(initialConfigTopic ?? '')
  const [deleteRemovedData, setDeleteRemovedData] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [saving, startSave] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)

  function stop() {
    esRef.current?.close()
    esRef.current = null
    setRunning(false)
  }

  function start() {
    stop()
    setMessages({})
    setSelectedTopic(null)
    setError(null)
    setRunning(true)

    const es = new EventSource(
      `/api/mqtt/browse?filter=${encodeURIComponent(filter.trim() || '#')}`
    )
    esRef.current = es

    es.onmessage = (e) => {
      let msg: StreamEvent
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'message') {
        setMessages((prev) => ({ ...prev, [msg.topic]: msg }))
        setSelectedTopic((prev) => prev ?? msg.topic)
      } else if (msg.type === 'error') {
        setError(msg.error)
        stop()
      }
    }
    es.onerror = () => {
      if (esRef.current !== es) return // already stopped/replaced
      setError((prev) => prev ?? 'Could not reach the broker, or the connection dropped.')
      stop()
    }
  }

  // Latest payloads, read inside the topic-change effect without re-running it
  // on every incoming message.
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // A sensor maps to one topic — reset the field selection when the topic
  // changes. When converting, re-tick the existing mappings whose paths still
  // resolve in this payload, so their metric names (and therefore their
  // history) carry over unchanged.
  // Editing seeds topic/fields/topics from the saved sensor; don't let the
  // mount-time run of this effect wipe them.
  const skipTopicReset = useRef(mode === 'edit')

  useEffect(() => {
    setSaveError(null)
    if (skipTopicReset.current) {
      skipTopicReset.current = false
      return
    }
    if (!selectedTopic) {
      setFields([])
      return
    }
    const msg = messagesRef.current[selectedTopic]
    if ((mode === 'convert' || mode === 'edit') && msg?.isJson && existingFields?.length) {
      setFields(existingFields.filter((f) => isCapturable(getAtPath(msg.payload, f.path))))
    } else {
      setFields([])
    }
    // Suggest a sibling topic that looks like an availability signal; the
    // operator can change or clear it.
    const others = Object.keys(messagesRef.current).filter((t) => t !== selectedTopic)
    setAvailabilityTopic(others.find((t) => /status|online|avail|lwt|state/i.test(t)) ?? '')
  }, [selectedTopic, mode, existingFields])

  // Close the stream if the user navigates away.
  useEffect(() => () => esRef.current?.close(), [])

  const topics = Object.values(messages).sort((a, b) => a.topic.localeCompare(b.topic))
  const selected = selectedTopic ? messages[selectedTopic] : undefined

  /** Legacy copy path: works on plain http and when the document isn't focused. */
  function legacyCopy(text: string): boolean {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  async function copyRaw() {
    if (!selected) return
    const text = selected.raw
    let ok = false
    // Sensify is usually reached over plain http on a LAN address, which isn't
    // a secure context, so the async clipboard API is often unavailable — and
    // it can reject even where it exists. Fall back rather than fail silently.
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        ok = true
      } catch {
        ok = legacyCopy(text)
      }
    } else {
      ok = legacyCopy(text)
    }
    setCopyState(ok ? 'copied' : 'failed')
    setTimeout(() => setCopyState('idle'), 2000)
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

  const duplicateMetrics = new Set(
    fields.map((f) => f.metric.trim()).filter((m, i, arr) => arr.indexOf(m) !== i)
  )
  const canSave =
    !!selected?.isJson &&
    !!selectedTopic &&
    name.trim() !== '' &&
    fields.length > 0 &&
    fields.every((f) => f.metric.trim() !== '') &&
    duplicateMetrics.size === 0

  function save() {
    if (!selectedTopic || !selected) return
    setSaveError(null)
    const payload = {
      name: name.trim(),
      topic: selectedTopic,
      availabilityTopic: availabilityTopic.trim() || undefined,
      configTopic: configTopic.trim() || undefined,
      fields: fields.map((f) => ({
        path: f.path,
        metric: f.metric.trim(),
        unit: f.unit?.trim() || undefined,
      })),
      sample: selected.raw,
    }
    startSave(async () => {
      const res =
        mode === 'edit' && sensorId
          ? await updateMqttSensorAction(sensorId, payload, { deleteRemovedData })
          : mode === 'convert' && sensorId
          ? await convertSensorToMqttAction(sensorId, payload)
          : await createMqttSensorAction(payload)
      if (res.error) {
        setSaveError(res.error)
      } else {
        stop()
        router.push(`/sensors/${res.id}`)
      }
    })
  }

  // Existing metric series that this selection will NOT feed. Their history is
  // kept, but they stop receiving new readings — covers both removing a field
  // and renaming its metric (a rename starts a fresh series).
  const selectedMetrics = new Set(fields.map((f) => f.metric.trim()))
  const orphanedMetrics =
    mode === 'convert' || mode === 'edit'
      ? (existingMetrics ?? []).filter((m) => !selectedMetrics.has(m))
      : []

  // Mapped paths that aren't in the payload we're looking at — the usual reason
  // to remove a field (e.g. a value the device stopped publishing).
  const missingPaths = new Set(
    selected?.isJson
      ? fields.filter((f) => !isCapturable(getAtPath(selected.payload, f.path))).map((f) => f.path)
      : []
  )

  return (
    <div className="space-y-4">
      {/* Topic filter */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-medium text-foreground">Topic filter</h2>
        <p className="text-xs text-muted-foreground">
          Subscribe to a topic filter and watch what arrives, live. Use <code>#</code> to see
          everything, or narrow it, e.g. <code>shellyplugusg4-abc/#</code>. Wildcards: <code>+</code>{' '}
          matches one level, <code>#</code> matches the rest.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running) start()
            }}
            placeholder="#"
            disabled={running}
            className={`flex-1 font-mono text-xs ${inputClass} disabled:opacity-60`}
          />
          {running ? (
            <Button size="sm" variant="ghost" onPress={stop}>
              <Square size={14} />
              Stop
            </Button>
          ) : (
            <Button size="sm" onPress={start} isDisabled={filter.trim() === ''}>
              <Radio size={14} />
              Listen
            </Button>
          )}
        </div>
        {error ? (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <X size={13} />
            {error}
          </p>
        ) : running ? (
          <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
            Listening… {topics.length} topic{topics.length === 1 ? '' : 's'} so far
          </p>
        ) : topics.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Stopped · {topics.length} topic{topics.length === 1 ? '' : 's'}
          </p>
        ) : null}
      </section>

      {/* Results */}
      {(running || topics.length > 0) && (
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-medium text-foreground">Payload &amp; fields</h2>
              {selected && (
                <button
                  type="button"
                  onClick={copyRaw}
                  className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                    copyState === 'failed'
                      ? 'border-destructive/40 text-destructive'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                  title={`Copy the raw payload of ${selected.topic}`}
                >
                  {copyState === 'copied' ? <Check size={12} /> : <Copy size={12} />}
                  {copyState === 'copied'
                    ? 'Copied'
                    : copyState === 'failed'
                      ? 'Copy blocked'
                      : 'Copy raw JSON'}
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Pick a topic, then tick the numeric or boolean values to record. Booleans are stored
              as 0/1.
            </p>
          </div>
          {topics.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Waiting for messages… retained values show immediately; live ones appear as devices
              publish.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_1.6fr] gap-3">
              {/* Topic list */}
              <ul className="space-y-0.5 max-h-80 overflow-y-auto pr-1">
                {topics.map((m) => (
                  <li key={m.topic}>
                    <button
                      type="button"
                      onClick={() => setSelectedTopic(m.topic)}
                      className={`w-full text-left px-2 py-1.5 rounded-md font-mono text-xs truncate transition-colors ${
                        m.topic === selectedTopic
                          ? 'bg-primary/10 text-foreground'
                          : 'text-muted-foreground hover:bg-muted/50'
                      }`}
                      title={m.topic}
                    >
                      {m.retain && (
                        <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] not-italic text-muted-foreground">
                          retained
                        </span>
                      )}
                      {m.topic}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Selected payload — selectable when JSON, updates live */}
              <div className="rounded-md border border-border bg-background/50 p-3 font-mono text-xs leading-7 overflow-x-auto min-h-24">
                {selected ? (
                  selected.isJson ? (
                    <JsonTree
                      value={selected.payload}
                      selected={new Set(fields.map((f) => f.path))}
                      onToggle={toggleField}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                      {selected.raw}
                    </pre>
                  )
                ) : (
                  <span className="text-muted-foreground">Select a topic to inspect its payload.</span>
                )}
              </div>
            </div>
          )}

          {selected && !selected.isJson && (
            <p className="text-xs text-muted-foreground">
              This payload isn&apos;t JSON, so there are no fields to pick. MQTT sensors need a JSON
              payload.
            </p>
          )}
        </section>
      )}

      {/* Create sensor */}
      {selected?.isJson && fields.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div>
            <h2 className="text-sm font-medium text-foreground">
              {mode === 'convert'
                ? 'Switch this sensor to MQTT'
                : mode === 'edit'
                  ? 'Edit MQTT sensor'
                  : 'Create MQTT sensor'}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Reading from <code className="font-mono">{selectedTopic}</code>
            </p>
            {mode === 'convert' && (
              <p className="text-xs text-muted-foreground mt-1">
                Same sensor, same history — only the transport changes. Keep each metric name as-is
                and its existing readings continue in the same series.
              </p>
            )}
          </div>

          {orphanedMetrics.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-amber-600/30 bg-amber-500/5 p-2.5">
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No field is mapped to{' '}
                <span className="font-mono">{orphanedMetrics.join(', ')}</span>. Existing readings
                are kept, but {orphanedMetrics.length === 1 ? 'that metric' : 'those metrics'} will
                stop getting new data
                {mode === 'edit' ? '' : ' after the switch'}. Renaming a metric has the same effect
                — the old series stops and a new one starts.
              </p>
              {mode === 'edit' && (
                <label className="flex items-start gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteRemovedData}
                    onChange={(e) => setDeleteRemovedData(e.target.checked)}
                    className="mt-0.5 accent-[var(--color-primary,currentColor)]"
                  />
                  <span>
                    Also delete existing readings for{' '}
                    <span className="font-mono">{orphanedMetrics.join(', ')}</span>. Permanent —
                    use this for a metric that never produced real data.
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Selected fields</h3>
            {fields.map((f) => (
              <div key={f.path} className="flex items-center gap-2">
                <code
                  className={`flex-1 min-w-0 truncate text-xs ${
                    missingPaths.has(f.path) ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                  }`}
                  title={
                    missingPaths.has(f.path)
                      ? 'Not present in this payload — the device may have stopped publishing it'
                      : f.path
                  }
                >
                  {f.path}
                  {missingPaths.has(f.path) && ' — not in payload'}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="mqtt-sensor-name" className="text-xs text-muted-foreground">
                Sensor name
              </label>
              <input
                id="mqtt-sensor-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rainforest"
                className={`w-full ${inputClass}`}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mqtt-availability" className="text-xs text-muted-foreground">
                Availability topic (optional)
              </label>
              <select
                id="mqtt-availability"
                value={availabilityTopic}
                onChange={(e) => setAvailabilityTopic(e.target.value)}
                className={`w-full font-mono text-xs ${inputClass}`}
              >
                <option value="">None</option>
                {Array.from(
                  new Set(
                    [
                      // Keep the saved value selectable even before Listen has
                      // rediscovered it, so editing can't silently clear it.
                      ...(availabilityTopic ? [availabilityTopic] : []),
                      ...topics.map((m) => m.topic),
                    ].filter((t) => t !== selectedTopic)
                  )
                ).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Carries online/offline, so the sensor can show when the device drops.
              </p>
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Device config topic (optional)
            </summary>
            <div className="mt-2 space-y-1">
              <input
                type="text"
                value={configTopic}
                onChange={(e) => setConfigTopic(e.target.value)}
                placeholder="sensify/config/esp32-abc123"
                aria-label="Device config topic"
                className={`w-full font-mono text-xs ${inputClass}`}
              />
              <p className="text-[11px] text-muted-foreground">
                Sensify publishes <code>{'{"interval": <seconds>}'}</code> here with the retain flag
                when you set a reporting interval. A device that subscribes gets its config
                immediately on connect. Leave blank if your device doesn&apos;t read config.
              </p>
            </div>
          </details>

          <div className="flex items-center justify-end gap-2">
            {saveError && <span className="text-sm text-destructive mr-auto">{saveError}</span>}
            <Button size="sm" onPress={save} isDisabled={!canSave || saving}>
              {saving
                ? 'Saving…'
                : mode === 'convert'
                  ? 'Switch to MQTT'
                  : mode === 'edit'
                    ? 'Save changes'
                    : 'Create sensor'}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
