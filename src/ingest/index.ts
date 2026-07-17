// Long-running MQTT subscriber — a third ingest transport peer to push (web)
// and pull (poller). Subscribes to the topics of configured MQTT sensors and
// writes their readings, mirroring the poller's shape but event-driven. Start
// with: pnpm ingest
import mqtt from 'mqtt'
import { mqttConfigFromEnv } from '../lib/mqtt-config'
import { listEnabledMqttSensors, recordMqttReading, recordMqttFailure } from '../lib/repo'
import { sweepOpenRules } from '../lib/alerts/engine'
import { processMessage } from './process'
import type { SensorMeta } from '../lib/types'

const broker = mqttConfigFromEnv()

const RECONNECT_MS = 5_000
const RELOAD_MS = 15_000 // re-read the sensor list, matching the poller
const ALERT_SWEEP_MS = 15_000

// topic -> the sensors that read from it (usually one, but a topic can feed
// more than one sensor with different field mappings).
let topicMap = new Map<string, SensorMeta[]>()
let stopping = false

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function buildTopicMap(sensors: SensorMeta[]): Map<string, SensorMeta[]> {
  const map = new Map<string, SensorMeta[]>()
  for (const s of sensors) {
    const topic = s.mqtt?.topic
    if (!topic) continue
    const arr = map.get(topic)
    if (arr) arr.push(s)
    else map.set(topic, [s])
  }
  return map
}

/** Re-read enabled MQTT sensors and reconcile subscriptions (QoS 1 for readings). */
async function reload(client: mqtt.MqttClient) {
  const next = buildTopicMap(await listEnabledMqttSensors())
  for (const topic of next.keys()) {
    if (!topicMap.has(topic)) {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) log(`subscribe to ${topic} failed: ${err.message}`)
        else log(`subscribed to ${topic}`)
      })
    }
  }
  for (const topic of topicMap.keys()) {
    if (!next.has(topic)) client.unsubscribe(topic, () => log(`unsubscribed from ${topic}`))
  }
  topicMap = next
}

function handleMessage(topic: string, payload: Buffer, packet: mqtt.IPublishPacket) {
  const sensors = topicMap.get(topic)
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
    topicMap = new Map()
    reload(client)
      .then(() => log(`watching ${topicMap.size} topic(s)`))
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
