// Long-running poller for pull devices. Runs alongside the Next.js web app
// and shares its SQLite database (WAL mode). Start with: pnpm poller
import {
  listEnabledPullSensors,
  recordPollSuccess,
  recordPollFailure,
} from '../lib/repo'
import { getAtPath, isCapturable, toMetricValue } from '../lib/json-path'
import { toCanonicalValue } from '../lib/units'
import type { SensorMeta } from '../lib/types'

const CONFIG_RELOAD_MS = 15_000
const TICK_MS = 1_000
const FETCH_TIMEOUT_MS = 5_000
const MAX_BACKOFF_MS = 300_000 // 5 min cap when a device keeps failing

interface ScheduledDevice {
  meta: SensorMeta
  nextDueAt: number
  inFlight: boolean
}

const devices = new Map<string, ScheduledDevice>()
let stopping = false

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

async function reloadDevices() {
  const list = await listEnabledPullSensors()
  const seen = new Set<string>()
  for (const meta of list) {
    seen.add(meta.id)
    const existing = devices.get(meta.id)
    if (existing) {
      const intervalChanged = existing.meta.pull!.pollInterval !== meta.pull!.pollInterval
      existing.meta = meta
      // Interval edits take effect immediately rather than after the old delay
      if (intervalChanged) existing.nextDueAt = Date.now()
    } else {
      devices.set(meta.id, { meta, nextDueAt: Date.now(), inFlight: false })
      log(`watching ${meta.name} (${meta.id}) every ${meta.pull!.pollInterval}s`)
    }
  }
  for (const id of devices.keys()) {
    if (!seen.has(id)) {
      log(`stopped watching ${devices.get(id)!.meta.name} (${id})`)
      devices.delete(id)
    }
  }
}

async function pollDevice(device: ScheduledDevice) {
  const { meta } = device
  const pull = meta.pull!
  device.inFlight = true
  try {
    const res = await fetch(pull.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error('Response is not valid JSON')
    }

    const metrics: { metric: string; value: number }[] = []
    const missing: string[] = []
    for (const field of pull.fields) {
      const raw = getAtPath(body, field.path)
      if (isCapturable(raw)) {
        // Canonical storage units: temperature fields are converted to °C
        metrics.push({ metric: field.metric, value: toCanonicalValue(toMetricValue(raw), field.unit) })
      } else {
        missing.push(field.path)
      }
    }

    if (metrics.length === 0) {
      throw new Error(`No configured fields resolved (${missing.join(', ')})`)
    }

    const softError =
      missing.length > 0
        ? `${metrics.length} of ${pull.fields.length} fields resolved; missing: ${missing.join(', ')}`
        : null
    await recordPollSuccess(meta.id, text.slice(0, 65536), metrics, softError)
    if (softError) log(`${meta.name}: ${softError}`)
    device.nextDueAt = Date.now() + pull.pollInterval * 1000
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const failures = await recordPollFailure(meta.id, message)
    // Exponential backoff on repeated failures, capped at 5 minutes
    const backoffMs = Math.min(pull.pollInterval * 1000 * 2 ** Math.min(failures, 6), MAX_BACKOFF_MS)
    device.nextDueAt = Date.now() + backoffMs
    log(`${meta.name}: poll failed (${message}), attempt ${failures}, retry in ${Math.round(backoffMs / 1000)}s`)
  } finally {
    device.inFlight = false
  }
}

async function main() {
  log('sensify poller starting')
  await reloadDevices()
  log(`${devices.size} pull device(s) enabled`)

  const configTimer = setInterval(() => {
    reloadDevices().catch((err) => log(`config reload failed: ${err}`))
  }, CONFIG_RELOAD_MS)

  const tickTimer = setInterval(() => {
    if (stopping) return
    const now = Date.now()
    for (const device of devices.values()) {
      if (!device.inFlight && device.nextDueAt <= now) {
        // Set next due optimistically so a slow poll can't double-fire
        device.nextDueAt = now + device.meta.pull!.pollInterval * 1000
        void pollDevice(device)
      }
    }
  }, TICK_MS)

  const shutdown = (signal: string) => {
    log(`received ${signal}, shutting down`)
    stopping = true
    clearInterval(configTimer)
    clearInterval(tickTimer)
    // Give in-flight polls a moment to finish writing
    setTimeout(() => process.exit(0), 1000)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('poller crashed:', err)
  process.exit(1)
})
