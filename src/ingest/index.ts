// Long-running MQTT subscriber — a third ingest transport peer to push (web)
// and pull (poller). Subscribes to the topics of configured MQTT sensors and
// writes their readings, mirroring the poller's shape but event-driven. Start
// with: pnpm ingest
import mqtt from 'mqtt'
import { mqttConfigFromEnv } from '../lib/mqtt-config'
import {
  listEnabledMqttSensors,
  recordMqttReading,
  recordMqttFailure,
  recordMqttAvailability,
} from '../lib/repo'
import { parseAvailability } from '../lib/mqtt-topic'
import { sweepOpenRules } from '../lib/alerts/engine'
import { processMessage } from './process'
import type { SensorMeta } from '../lib/types'

const broker = mqttConfigFromEnv()

const RECONNECT_MS = 5_000
const RELOAD_MS = 15_000 // re-read the sensor list, matching the poller
const ALERT_SWEEP_MS = 15_000

// topic -> the sensors that read from it (usually one, but a topic can feed
// more than one sensor with different field mappings).
let readingTopics = new Map<string, SensorMeta[]>()
// topic -> the sensors whose online/offline state it carries.
let availabilityTopics = new Map<string, SensorMeta[]>()
let stopping = false

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

/** Index sensors by one of their topics, skipping those that don't set it. */
function indexByTopic(
  sensors: SensorMeta[],
  pick: (s: SensorMeta) => string | null | undefined
): Map<string, SensorMeta[]> {
  const map = new Map<string, SensorMeta[]>()
  for (const s of sensors) {
    const topic = pick(s)
    if (!topic) continue
    const arr = map.get(topic)
    if (arr) arr.push(s)
    else map.set(topic, [s])
  }
  return map
}

/** Re-read enabled MQTT sensors and reconcile subscriptions (QoS 1). */
async function reload(client: mqtt.MqttClient) {
  const sensors = await listEnabledMqttSensors()
  const nextReading = indexByTopic(sensors, (s) => s.mqtt?.topic)
  const nextAvailability = indexByTopic(sensors, (s) => s.mqtt?.availabilityTopic)

  const before = new Set([...readingTopics.keys(), ...availabilityTopics.keys()])
  const after = new Set([...nextReading.keys(), ...nextAvailability.keys()])
  for (const topic of after) {
    if (!before.has(topic)) {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) log(`subscribe to ${topic} failed: ${err.message}`)
        else log(`subscribed to ${topic}`)
      })
    }
  }
  for (const topic of before) {
    if (!after.has(topic)) client.unsubscribe(topic, () => log(`unsubscribed from ${topic}`))
  }

  readingTopics = nextReading
  availabilityTopics = nextAvailability
}

function handleMessage(topic: string, payload: Buffer, packet: mqtt.IPublishPacket) {
  // Availability first. Retained messages are *kept* here, unlike reading
  // topics: the broker's retained value (and the device's LWT "offline") is
  // the current truth about whether the device is connected.
  const availabilitySensors = availabilityTopics.get(topic)
  if (availabilitySensors?.length) {
    const state = parseAvailability(payload.toString('utf8'))
    if (state === null) {
      log(`unrecognized availability payload on ${topic}: ${payload.toString('utf8').slice(0, 40)}`)
    } else {
      for (const s of availabilitySensors) {
        void recordMqttAvailability(s.id, state).catch((e) => log(`availability write: ${e}`))
        log(`${s.name} is ${state ? 'online' : 'offline'}`)
      }
    }
  }

  const sensors = readingTopics.get(topic)
  if (!sensors || sensors.length === 0) return

  const result = processMessage(sensors, payload, packet.retain)
  if (result.retainedDropped) {
    log(`dropped retained message on ${topic}`)
    return
  }

  for (const p of result.persist) {
    void recordMqttReading(p.sensorId, p.sample, p.metrics).catch((e) =>
      log(`persist failed for ${p.sensorId}: ${e}`)
    )
  }
  for (const f of result.failures) {
    void recordMqttFailure(f.sensorId, f.reason).catch((e) => log(`record failure: ${e}`))
    log(`${f.sensorId}: ${f.reason}`)
  }
}

function main() {
  const client = mqtt.connect(broker.url, {
    username: broker.username,
    password: broker.password,
    reconnectPeriod: RECONNECT_MS,
    clientId: `sensify-ingest-${process.pid}`,
  })

  log(`sensify mqtt-ingest starting; connecting to ${broker.url}`)

  client.on('connect', () => {
    log('connected to broker')
    // Re-subscribe from scratch on every (re)connect.
    readingTopics = new Map()
    availabilityTopics = new Map()
    reload(client)
      .then(() =>
        log(
          `watching ${readingTopics.size} reading topic(s), ${availabilityTopics.size} availability topic(s)`
        )
      )
      .catch((err) => log(`initial reload failed: ${err}`))
  })

  client.on('message', handleMessage)

  const reloadTimer = setInterval(() => {
    if (!stopping) reload(client).catch((err) => log(`reload failed: ${err}`))
  }, RELOAD_MS)

  // Advance alert dwell/cooldown timers between readings. The poller runs the
  // same sweep; concurrent sweeps are safe (each transition commits under
  // BEGIN IMMEDIATE), and running our own keeps alerts advancing even if the
  // poller is stopped once pull has no devices.
  const sweepTimer = setInterval(() => {
    if (!stopping) sweepOpenRules()
  }, ALERT_SWEEP_MS)

  client.on('reconnect', () => log('reconnecting…'))
  client.on('close', () => log('connection closed'))
  client.on('offline', () => log('offline'))
  client.on('error', (err) => log(`error: ${err.message}`))

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`)
    stopping = true
    clearInterval(reloadTimer)
    clearInterval(sweepTimer)
    client.end(false, {}, () => process.exit(0))
    setTimeout(() => process.exit(0), 2_000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main()
