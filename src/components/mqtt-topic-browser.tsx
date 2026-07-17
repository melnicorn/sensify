'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { Radio, Square, X } from 'lucide-react'
import { JsonTree } from '@/components/json-tree'
import type { MqttBrowseMessage } from '@/lib/mqtt-topic'

const inputClass =
  'rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'

type StreamEvent =
  | ({ type: 'message' } & MqttBrowseMessage)
  | { type: 'ready'; filter: string }
  | { type: 'error'; error: string }

export function MqttTopicBrowser() {
  const [filter, setFilter] = useState('#')
  const [running, setRunning] = useState(false)
  const [messages, setMessages] = useState<Record<string, MqttBrowseMessage>>({})
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

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

  // Close the stream if the user navigates away.
  useEffect(() => () => esRef.current?.close(), [])

  const topics = Object.values(messages).sort((a, b) => a.topic.localeCompare(b.topic))
  const selected = selectedTopic ? messages[selectedTopic] : undefined

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
          <h2 className="text-sm font-medium text-foreground">Payloads</h2>
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

              {/* Selected payload (updates live as new messages arrive) */}
              <div className="rounded-md border border-border bg-background/50 p-3 font-mono text-xs leading-7 overflow-x-auto min-h-24">
                {selected ? (
                  selected.isJson ? (
                    <JsonTree value={selected.payload} />
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
          <p className="text-xs text-muted-foreground">
            Browsing only for now — picking fields and saving an MQTT sensor comes next.
          </p>
        </section>
      )}
    </div>
  )
}
