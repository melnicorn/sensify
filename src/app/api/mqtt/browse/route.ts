import type { NextRequest } from 'next/server'
import mqtt, { type MqttClient } from 'mqtt'
import { mqttConfigFromEnv } from '@/lib/mqtt-config'
import { isValidTopicFilter, parseMqttPayload, MQTT_MAX_PAYLOAD_CHARS } from '@/lib/mqtt-topic'

// Long-lived Server-Sent Events stream: subscribe to a topic filter and push
// every message to the browser as it arrives, until the client disconnects
// (navigates away or hits Stop). This is the live analogue of the pull flow's
// one-shot fetch — MQTT is push, so a snapshot misses interval publishers.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CONNECT_TIMEOUT_MS = 4_000
const HEARTBEAT_MS = 25_000 // comment ping so idle streams aren't buffered/closed

export async function GET(request: NextRequest) {
  const filter = request.nextUrl.searchParams.get('filter')?.trim() || '#'
  if (!isValidTopicFilter(filter)) {
    return new Response('Invalid topic filter', { status: 400 })
  }

  const cfg = mqttConfigFromEnv()
  const encoder = new TextEncoder()

  let client: MqttClient | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    try {
      client?.end(true)
    } catch {
      /* already gone */
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* controller already closed */
        }
      }
      const endStream = () => {
        cleanup()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      client = mqtt.connect(cfg.url, {
        username: cfg.username,
        password: cfg.password,
        reconnectPeriod: 0, // one browse session; don't silently reconnect
        connectTimeout: CONNECT_TIMEOUT_MS,
        clientId: `sensify-browse-${process.pid}-${Date.now()}`,
      })

      client.on('connect', () => {
        client!.subscribe(filter, { qos: 0 }, (err) => {
          if (err) {
            send({ type: 'error', error: `Subscribe failed: ${err.message}` })
            endStream()
          } else {
            send({ type: 'ready', filter })
          }
        })
      })

      client.on('message', (topic, payload, packet) => {
        const full = payload.toString('utf8')
        const raw =
          full.length > MQTT_MAX_PAYLOAD_CHARS ? full.slice(0, MQTT_MAX_PAYLOAD_CHARS) : full
        const { payload: parsed, isJson } = parseMqttPayload(raw)
        send({ type: 'message', topic, retain: packet.retain, payload: parsed, raw, isJson })
      })

      client.on('error', (err) => {
        send({ type: 'error', error: err.message })
        endStream()
      })
      // Broker dropped the connection without an explicit error.
      client.on('close', () => {
        if (!closed) {
          send({ type: 'error', error: 'Broker connection closed' })
          endStream()
        }
      })

      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          /* closed */
        }
      }, HEARTBEAT_MS)

      // Client went away (Stop / navigation) → tear down the broker connection.
      request.signal.addEventListener('abort', endStream)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
