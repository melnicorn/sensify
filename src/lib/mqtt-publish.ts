// One-shot retained publish from the web process, used to push device config.
//
// The push API hands a device its config in the POST response; MQTT has no
// request/response idiom, so the equivalent is a retained message on a
// per-device config topic. Retained is the point: a device that subscribes
// gets its config immediately on connect instead of waiting for a round trip.
import mqtt from 'mqtt'
import { mqttConfigFromEnv } from './mqtt-config'

const CONNECT_TIMEOUT_MS = 4_000
const OVERALL_TIMEOUT_MS = 6_000

/** Publish a retained message. An empty payload clears the retained value. */
export async function publishRetained(topic: string, payload: string): Promise<void> {
  const cfg = mqttConfigFromEnv()

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const client = mqtt.connect(cfg.url, {
      username: cfg.username,
      password: cfg.password,
      reconnectPeriod: 0, // one-shot: fail rather than retry in the background
      connectTimeout: CONNECT_TIMEOUT_MS,
      clientId: `sensify-publish-${process.pid}-${Date.now()}`,
    })

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        client.end(true)
      } catch {
        /* already gone */
      }
      if (err) reject(err)
      else resolve()
    }

    const timer = setTimeout(() => finish(new Error('Publish timed out')), OVERALL_TIMEOUT_MS)

    client.on('connect', () => {
      client.publish(topic, payload, { retain: true, qos: 1 }, (err) =>
        finish(err ?? undefined)
      )
    })
    client.on('error', (err) => finish(err))
  })
}
