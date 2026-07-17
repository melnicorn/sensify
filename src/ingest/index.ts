// Long-running MQTT subscriber — a third ingest transport peer to push (web)
// and pull (poller). Runs alongside them, shares the same image, and starts
// with: pnpm ingest
//
// Phase 1 (this file) proves the deployment story only: it connects to the
// broker, subscribes, and logs what arrives. It does NOT touch the database.
// Reading persistence, field mapping, retained-message handling, and the
// alert sweep arrive in later phases.
import mqtt from 'mqtt'
import { mqttConfigFromEnv } from '../lib/mqtt-config'

// Broker connection (url + credentials) from the shared env helper.
const broker = mqttConfigFromEnv()
// What to listen to. '#' is every topic — correct for phase-1 bring-up and for
// the topic browser later; real sensors will subscribe to their own topics.
const MQTT_TOPIC_FILTER = process.env.MQTT_TOPIC_FILTER ?? '#'

const RECONNECT_MS = 5_000
const PAYLOAD_PREVIEW_CHARS = 200

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function preview(payload: Buffer): string {
  const text = payload.toString('utf8')
  return text.length > PAYLOAD_PREVIEW_CHARS
    ? `${text.slice(0, PAYLOAD_PREVIEW_CHARS)}… (${payload.length} bytes)`
    : text
}

function main() {
  // mqtt.js keeps its own reconnect loop, so this process stays up across
  // broker restarts rather than crashing — matching the poller's resilience.
  const client = mqtt.connect(broker.url, {
    username: broker.username,
    password: broker.password,
    reconnectPeriod: RECONNECT_MS,
    // A stable client id makes the connection identifiable in broker logs.
    clientId: `sensify-ingest-${process.pid}`,
  })

  log(`sensify mqtt-ingest starting; connecting to ${broker.url}`)

  client.on('connect', () => {
    log('connected to broker')
    client.subscribe(MQTT_TOPIC_FILTER, { qos: 1 }, (err) => {
      if (err) log(`subscribe to "${MQTT_TOPIC_FILTER}" failed: ${err.message}`)
      else log(`subscribed to "${MQTT_TOPIC_FILTER}" (qos 1)`)
    })
  })

  client.on('message', (topic, payload, packet) => {
    // packet.retain distinguishes a live reading from a replayed retained
    // state message — the phase-3 hazard. Surfaced here so it's observable
    // during bring-up; nothing is persisted yet.
    log(`${topic}${packet.retain ? ' [retained]' : ''}: ${preview(payload)}`)
  })

  client.on('reconnect', () => log('reconnecting…'))
  client.on('close', () => log('connection closed'))
  client.on('offline', () => log('offline'))
  client.on('error', (err) => log(`error: ${err.message}`))

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`)
    // force=false lets in-flight QoS handshakes settle; the callback exits.
    client.end(false, {}, () => process.exit(0))
    // Safety net if the broker never acknowledges the disconnect.
    setTimeout(() => process.exit(0), 2_000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main()
