'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { Radio, Square, X, Trash2 } from 'lucide-react'
import { JsonTree } from '@/components/json-tree'
import { createMqttSensorAction } from '@/app/actions'
import type { MqttBrowseMessage } from '@/lib/mqtt-topic'
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

export function MqttTopicBrowser() {
  const router = useRouter()
  const [filter, setFilter] = useState('#')
  const [running, setRunning] = useState(false)
  const [messages, setMessages] = useState<Record<string, MqttBrowseMessage>>({})
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // Field selection + sensor details for the currently selected topic.
  const [fields, setFields] = useState<PullField[]>([])
  const [name, setName] = useState('')
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

  // A sensor maps to one topic — reset the field selection when the topic changes.
  useEffect(() => {
    setFields([])
    setSaveError(null)
  }, [selectedTopic])

  // Close the stream if the user navigates away.
  useEffect(() => () => esRef.current?.close(), [])

  const topics = Object.values(messages).sort((a, b) => a.topic.localeCompare(b.topic))
  const selected = selectedTopic ? messages[selectedTopic] : undefined

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
      fields: fields.map((f) => ({
        path: f.path,
        metric: f.metric.trim(),
        unit: f.unit?.trim() || undefined,
      })),
      sample: selected.raw,
    }
    startSave(async () => {
      const res = await createMqttSensorAction(payload)
      if (res.error) {
        setSaveError(res.error)
      } else {
        stop()
        router.push(`/sensors/${res.id}`)
      }
    })
  }

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
            <h2 className="text-sm font-medium text-foreground">Payload &amp; fields</h2>
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
            <h2 className="text-sm font-medium text-foreground">Create MQTT sensor</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Reading from <code className="font-mono">{selectedTopic}</code>
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Selected fields</h3>
            {fields.map((f) => (
              <div key={f.path} className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{f.path}</code>
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
              className={`w-full sm:w-72 ${inputClass}`}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            {saveError && <span className="text-sm text-destructive mr-auto">{saveError}</span>}
            <Button size="sm" onPress={save} isDisabled={!canSave || saving}>
              {saving ? 'Saving…' : 'Create sensor'}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
