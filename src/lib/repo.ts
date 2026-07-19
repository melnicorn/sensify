import { getDb } from './db'
import { convertTemperature, parseUnitLabel } from './units'
import { evaluateReading } from './alerts/engine'
import type {
  SensorMeta,
  SensorType,
  PullField,
  MetricReading,
  LatestMetric,
  AppConfig,
  TemperatureUnit,
} from './types'
import type { ReadingInput } from './schemas'

// ---------- row mapping ----------

interface SensorRow {
  id: string
  type: SensorType
  name: string
  first_seen: string
  last_seen: string
  last_ip: string | null
  location: string | null
  floor: number | null
  zone: string | null
  description: string | null
  hardware: string | null
  tags: string | null
  desired_interval: number | null
  url: string | null
  poll_interval: number | null
  enabled: number
  last_success: string | null
  last_error: string | null
  consecutive_failures: number
  last_sample: string | null
  topic: string | null
  qos: number | null
  availability_topic: string | null
  online: number | null
  online_at: string | null
  config_topic: string | null
}

function rowToMeta(row: SensorRow, fields: PullField[]): SensorMeta {
  const meta: SensorMeta = {
    id: row.id,
    type: row.type,
    name: row.name,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastIp: row.last_ip ?? undefined,
    location: row.location ?? undefined,
    floor: row.floor,
    zone: row.zone ?? undefined,
    description: row.description ?? undefined,
    hardware: row.hardware ?? undefined,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined,
    desiredInterval: row.desired_interval,
  }
  if (row.type === 'pull') {
    meta.pull = {
      url: row.url ?? '',
      pollInterval: row.poll_interval ?? 60,
      enabled: row.enabled === 1,
      fields,
      lastSuccess: row.last_success,
      lastError: row.last_error,
      consecutiveFailures: row.consecutive_failures,
      lastSample: row.last_sample,
    }
  } else if (row.type === 'mqtt') {
    meta.mqtt = {
      topic: row.topic ?? '',
      qos: row.qos ?? 1,
      enabled: row.enabled === 1,
      fields,
      lastSuccess: row.last_success,
      lastError: row.last_error,
      consecutiveFailures: row.consecutive_failures,
      lastSample: row.last_sample,
      availabilityTopic: row.availability_topic,
      online: row.online === null ? null : row.online === 1,
      onlineAt: row.online_at,
      configTopic: row.config_topic,
    }
  }
  return meta
}

/** Pull and mqtt sensors both carry pull_fields mappings; push sensors don't. */
function hasFieldMappings(type: SensorType): boolean {
  return type === 'pull' || type === 'mqtt'
}

function getFields(sensorId: string): PullField[] {
  const rows = getDb()
    .prepare(
      'SELECT path, metric, unit, unit_kind FROM pull_fields WHERE sensor_id = ? ORDER BY metric'
    )
    .all(sensorId) as {
    path: string
    metric: string
    unit: string | null
    unit_kind: string | null
  }[]
  return rows.map((r) => ({
    path: r.path,
    metric: r.metric,
    unit: r.unit ?? undefined,
    unitKind: r.unit_kind === 'temperature' ? 'temperature' : null,
  }))
}

// ---------- sensors ----------

export async function listSensors(): Promise<SensorMeta[]> {
  const rows = getDb().prepare('SELECT * FROM sensors ORDER BY name COLLATE NOCASE').all() as SensorRow[]
  return rows.map((r) => rowToMeta(r, hasFieldMappings(r.type) ? getFields(r.id) : []))
}

export async function getSensorMeta(sensorId: string): Promise<SensorMeta | null> {
  const row = getDb().prepare('SELECT * FROM sensors WHERE id = ?').get(sensorId) as
    | SensorRow
    | undefined
  if (!row) return null
  return rowToMeta(row, hasFieldMappings(row.type) ? getFields(row.id) : [])
}

export async function updateSensorMeta(
  sensorId: string,
  updates: {
    name?: string
    location?: string
    floor?: number | null
    zone?: string
    description?: string
    hardware?: string
    tags?: string[]
  }
): Promise<void> {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM sensors WHERE id = ?').get(sensorId)
  if (!existing) throw new Error(`Sensor ${sensorId} not found`)
  db.prepare(
    `UPDATE sensors SET
       name = COALESCE(?, name),
       location = ?, floor = ?, zone = ?, description = ?, hardware = ?, tags = ?
     WHERE id = ?`
  ).run(
    updates.name ?? null,
    updates.location ?? null,
    updates.floor ?? null,
    updates.zone ?? null,
    updates.description ?? null,
    updates.hardware ?? null,
    updates.tags ? JSON.stringify(updates.tags) : null,
    sensorId
  )
}

export async function updateDesiredInterval(
  sensorId: string,
  interval: number | null
): Promise<void> {
  const result = getDb()
    .prepare('UPDATE sensors SET desired_interval = ? WHERE id = ?')
    .run(interval, sensorId)
  if (result.changes === 0) throw new Error(`Sensor ${sensorId} not found`)
}

export async function deleteSensorData(sensorId: string): Promise<void> {
  const db = getDb()
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM readings WHERE sensor_id = ?').run(sensorId)
    db.prepare('DELETE FROM sensors WHERE id = ?').run(sensorId) // pull_fields cascade
  })
  tx()
}

// ---------- shared reading write path ----------

/** Insert reading rows. Call inside a transaction. Shared by push/pull/mqtt. */
function insertReadingRows(
  db: ReturnType<typeof getDb>,
  sensorId: string,
  metrics: { metric: string; value: number }[],
  tsIso: string
): void {
  const insert = db.prepare('INSERT INTO readings (sensor_id, ts, metric, value) VALUES (?, ?, ?, ?)')
  for (const m of metrics) insert.run(sensorId, tsIso, m.metric, m.value)
}

/** Run the alert engine per metric. Call after the write commits; never throws. */
function evaluateReadings(
  sensorId: string,
  metrics: { metric: string; value: number }[],
  tsIso: string
): void {
  for (const m of metrics) evaluateReading(sensorId, m.metric, m.value, tsIso)
}

// ---------- push ingest ----------

export async function saveReading(
  input: ReadingInput,
  callerIp: string
): Promise<{ id: string; timestamp: string; desiredConfig: { interval: number } | null }> {
  const db = getDb()
  const now = new Date().toISOString()

  // Normalize to canonical storage units: temperature °C, humidity %
  const metrics: { metric: string; value: number }[] = []
  if (input.data.temperature) {
    metrics.push({
      metric: 'temperature',
      value: convertTemperature(input.data.temperature.value, input.data.temperature.unit, 'C'),
    })
  }
  if (input.data.humidity) {
    metrics.push({ metric: 'humidity', value: input.data.humidity.value })
  }

  let desiredInterval: number | null = null
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM sensors WHERE id = ?').get(input.sensorId) as
      | SensorRow
      | undefined
    const isNew = !existing
    if (isNew) {
      db.prepare(
        `INSERT INTO sensors (id, type, name, first_seen, last_seen, last_ip)
         VALUES (?, 'push', ?, ?, ?, ?)`
      ).run(input.sensorId, input.sensorName, now, now, callerIp)
    } else {
      // Device never renames a sensor after registration — the UI owns name.
      db.prepare('UPDATE sensors SET last_seen = ?, last_ip = ? WHERE id = ?').run(
        now,
        callerIp,
        input.sensorId
      )
    }
    // Device-supplied meta seeds all fields on first registration.
    // On subsequent POSTs, device updates only the fields it explicitly sends.
    if (input.meta) {
      const m = input.meta
      const set = (col: string, val: unknown, provided: boolean) => {
        if (isNew || provided) {
          db.prepare(`UPDATE sensors SET ${col} = ? WHERE id = ?`).run(val ?? null, input.sensorId)
        }
      }
      set('location', m.location, m.location !== undefined)
      set('floor', m.floor, m.floor !== undefined)
      set('zone', m.zone, m.zone !== undefined)
      set('description', m.description, m.description !== undefined)
      set('hardware', m.hardware, m.hardware !== undefined)
      set('tags', m.tags ? JSON.stringify(m.tags) : null, m.tags !== undefined)
    }

    insertReadingRows(db, input.sensorId, metrics, now)

    const row = db
      .prepare('SELECT desired_interval FROM sensors WHERE id = ?')
      .get(input.sensorId) as { desired_interval: number | null }
    desiredInterval = row.desired_interval
  })
  tx()

  // Alert evaluation shares one code path with pull/mqtt ingest (never throws)
  evaluateReadings(input.sensorId, metrics, now)

  return {
    id: crypto.randomUUID(),
    timestamp: now,
    desiredConfig: desiredInterval != null ? { interval: desiredInterval } : null,
  }
}

// ---------- pull devices ----------

export async function createPullSensor(input: {
  name: string
  url: string
  pollInterval: number
  fields: PullField[]
  lastSample?: string | null
}): Promise<string> {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sensors (id, type, name, first_seen, last_seen, url, poll_interval, enabled, last_sample)
       VALUES (?, 'pull', ?, ?, ?, ?, ?, 1, ?)`
    ).run(id, input.name, now, now, input.url, input.pollInterval, input.lastSample ?? null)
    const insert = db.prepare(
      'INSERT INTO pull_fields (sensor_id, path, metric, unit, unit_kind) VALUES (?, ?, ?, ?, ?)'
    )
    for (const f of input.fields)
      insert.run(id, f.path, f.metric, f.unit ?? null, parseUnitLabel(f.unit)?.kind ?? null)
  })
  tx()
  return id
}

export async function updatePullSensor(
  sensorId: string,
  input: {
    name: string
    url: string
    pollInterval: number
    fields: PullField[]
    lastSample?: string | null
  }
): Promise<void> {
  const db = getDb()
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE sensors SET name = ?, url = ?, poll_interval = ?,
         last_sample = COALESCE(?, last_sample)
         WHERE id = ? AND type = 'pull'`
      )
      .run(input.name, input.url, input.pollInterval, input.lastSample ?? null, sensorId)
    if (result.changes === 0) throw new Error(`Pull sensor ${sensorId} not found`)
    db.prepare('DELETE FROM pull_fields WHERE sensor_id = ?').run(sensorId)
    const insert = db.prepare(
      'INSERT INTO pull_fields (sensor_id, path, metric, unit, unit_kind) VALUES (?, ?, ?, ?, ?)'
    )
    for (const f of input.fields)
      insert.run(sensorId, f.path, f.metric, f.unit ?? null, parseUnitLabel(f.unit)?.kind ?? null)
  })
  tx()
}

export async function setPullEnabled(sensorId: string, enabled: boolean): Promise<void> {
  const result = getDb()
    .prepare("UPDATE sensors SET enabled = ? WHERE id = ? AND type = 'pull'")
    .run(enabled ? 1 : 0, sensorId)
  if (result.changes === 0) throw new Error(`Pull sensor ${sensorId} not found`)
}

/** Enabled pull sensors with their field mappings — the poller's work list. */
export async function listEnabledPullSensors(): Promise<SensorMeta[]> {
  const rows = getDb()
    .prepare("SELECT * FROM sensors WHERE type = 'pull' AND enabled = 1")
    .all() as SensorRow[]
  return rows.map((r) => rowToMeta(r, getFields(r.id)))
}

export async function recordPollSuccess(
  sensorId: string,
  sample: string,
  metrics: { metric: string; value: number }[],
  softError: string | null
): Promise<string> {
  const db = getDb()
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    insertReadingRows(db, sensorId, metrics, now)
    db.prepare(
      `UPDATE sensors SET last_seen = ?, last_success = ?, last_sample = ?,
       consecutive_failures = 0, last_error = ? WHERE id = ?`
    ).run(now, now, sample, softError, sensorId)
  })
  tx()

  // Alert evaluation shares one code path with push/mqtt ingest (never throws)
  evaluateReadings(sensorId, metrics, now)

  return now
}

export async function recordPollFailure(sensorId: string, error: string): Promise<number> {
  const db = getDb()
  db.prepare(
    `UPDATE sensors SET last_error = ?, consecutive_failures = consecutive_failures + 1
     WHERE id = ?`
  ).run(error, sensorId)
  const row = db.prepare('SELECT consecutive_failures FROM sensors WHERE id = ?').get(sensorId) as
    | { consecutive_failures: number }
    | undefined
  return row?.consecutive_failures ?? 0
}

// ---------- mqtt devices ----------

export async function createMqttSensor(input: {
  name: string
  topic: string
  qos?: number
  availabilityTopic?: string | null
  configTopic?: string | null
  fields: PullField[]
  lastSample?: string | null
}): Promise<string> {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO sensors
         (id, type, name, first_seen, last_seen, topic, qos, availability_topic, config_topic, enabled, last_sample)
       VALUES (?, 'mqtt', ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      id,
      input.name,
      now,
      now,
      input.topic,
      input.qos ?? 1,
      input.availabilityTopic || null,
      input.configTopic || null,
      input.lastSample ?? null
    )
    const insert = db.prepare(
      'INSERT INTO pull_fields (sensor_id, path, metric, unit, unit_kind) VALUES (?, ?, ?, ?, ?)'
    )
    for (const f of input.fields)
      insert.run(id, f.path, f.metric, f.unit ?? null, parseUnitLabel(f.unit)?.kind ?? null)
  })
  tx()
  return id
}

export async function updateMqttSensor(
  sensorId: string,
  input: {
    name: string
    topic: string
    qos?: number
    availabilityTopic?: string | null
    configTopic?: string | null
    fields: PullField[]
    lastSample?: string | null
  }
): Promise<void> {
  const db = getDb()
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE sensors SET name = ?, topic = ?, qos = ?,
         availability_topic = ?, config_topic = ?,
         last_sample = COALESCE(?, last_sample)
         WHERE id = ? AND type = 'mqtt'`
      )
      .run(
        input.name,
        input.topic,
        input.qos ?? 1,
        input.availabilityTopic || null,
        input.configTopic || null,
        input.lastSample ?? null,
        sensorId
      )
    if (result.changes === 0) throw new Error(`MQTT sensor ${sensorId} not found`)
    db.prepare('DELETE FROM pull_fields WHERE sensor_id = ?').run(sensorId)
    const insert = db.prepare(
      'INSERT INTO pull_fields (sensor_id, path, metric, unit, unit_kind) VALUES (?, ?, ?, ?, ?)'
    )
    for (const f of input.fields)
      insert.run(sensorId, f.path, f.metric, f.unit ?? null, parseUnitLabel(f.unit)?.kind ?? null)
  })
  tx()
}

/**
 * Move an existing sensor onto MQTT **in place** — same row, same id, so its
 * readings, alert rules and metadata carry over untouched. `source` (the type
 * column) is a mutable attribute, not part of the sensor's identity: this is an
 * edit, not a re-registration, which is what keeps history from forking.
 *
 * Reusing the same metric names means new readings append to the existing
 * series; the caller (the convert UI) pre-fills them from the current mapping.
 */
export async function convertSensorToMqtt(
  sensorId: string,
  input: {
    name: string
    topic: string
    qos?: number
    availabilityTopic?: string | null
    configTopic?: string | null
    fields: PullField[]
    lastSample?: string | null
  }
): Promise<void> {
  const db = getDb()
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT type FROM sensors WHERE id = ?').get(sensorId) as
      | { type: SensorType }
      | undefined
    if (!existing) throw new Error(`Sensor ${sensorId} not found`)

    db.prepare(
      `UPDATE sensors SET
         type = 'mqtt',
         name = ?,
         topic = ?,
         qos = ?,
         availability_topic = ?,
         config_topic = ?,
         url = NULL,
         poll_interval = NULL,
         enabled = 1,
         last_error = NULL,
         consecutive_failures = 0,
         online = NULL,
         online_at = NULL,
         last_sample = COALESCE(?, last_sample)
       WHERE id = ?`
    ).run(
      input.name,
      input.topic,
      input.qos ?? 1,
      input.availabilityTopic || null,
      input.configTopic || null,
      input.lastSample ?? null,
      sensorId
    )

    // Field mappings are replaced wholesale (pull_fields is shared by both
    // sources); readings are keyed by (sensor_id, metric) and are untouched.
    db.prepare('DELETE FROM pull_fields WHERE sensor_id = ?').run(sensorId)
    const insert = db.prepare(
      'INSERT INTO pull_fields (sensor_id, path, metric, unit, unit_kind) VALUES (?, ?, ?, ?, ?)'
    )
    for (const f of input.fields)
      insert.run(sensorId, f.path, f.metric, f.unit ?? null, parseUnitLabel(f.unit)?.kind ?? null)
  })
  tx()
}

/**
 * Delete a sensor's readings for specific metrics. Used when a field mapping is
 * removed and the operator explicitly asks to drop its history too — e.g. a
 * metric that never produced real data over this transport. Opt-in, because
 * readings are otherwise kept: an unmapped metric simply stops growing.
 */
export async function deleteReadingsForMetrics(
  sensorId: string,
  metrics: string[]
): Promise<number> {
  if (metrics.length === 0) return 0
  const db = getDb()
  const placeholders = metrics.map(() => '?').join(', ')
  const result = db
    .prepare(`DELETE FROM readings WHERE sensor_id = ? AND metric IN (${placeholders})`)
    .run(sensorId, ...metrics)
  return result.changes
}

export async function setMqttEnabled(sensorId: string, enabled: boolean): Promise<void> {
  const result = getDb()
    .prepare("UPDATE sensors SET enabled = ? WHERE id = ? AND type = 'mqtt'")
    .run(enabled ? 1 : 0, sensorId)
  if (result.changes === 0) throw new Error(`MQTT sensor ${sensorId} not found`)
}

/** Enabled mqtt sensors with their field mappings — the ingest subscriber's work list. */
export async function listEnabledMqttSensors(): Promise<SensorMeta[]> {
  const rows = getDb()
    .prepare("SELECT * FROM sensors WHERE type = 'mqtt' AND enabled = 1")
    .all() as SensorRow[]
  return rows.map((r) => rowToMeta(r, getFields(r.id)))
}

/** Persist readings extracted from an MQTT message and mark the sensor seen. */
export async function recordMqttReading(
  sensorId: string,
  sample: string,
  metrics: { metric: string; value: number }[]
): Promise<string> {
  const db = getDb()
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    insertReadingRows(db, sensorId, metrics, now)
    db.prepare(
      `UPDATE sensors SET last_seen = ?, last_success = ?, last_sample = ?,
       consecutive_failures = 0, last_error = NULL WHERE id = ?`
    ).run(now, now, sample, sensorId)
  })
  tx()

  // Alert evaluation shares one code path with push/pull ingest (never throws)
  evaluateReadings(sensorId, metrics, now)

  return now
}

/**
 * Record a device's availability. Unlike readings, this is driven by retained
 * messages on purpose: the broker replays the last known state on subscribe,
 * and the LWT publishes "offline" if the device drops, so the retained value
 * is the truth rather than a stale reading.
 */
export async function recordMqttAvailability(sensorId: string, online: boolean): Promise<void> {
  getDb()
    .prepare('UPDATE sensors SET online = ?, online_at = ? WHERE id = ?')
    .run(online ? 1 : 0, new Date().toISOString(), sensorId)
}

/** Record a soft failure (e.g. a message whose configured fields didn't resolve). */
export async function recordMqttFailure(sensorId: string, error: string): Promise<void> {
  getDb()
    .prepare(
      `UPDATE sensors SET last_error = ?, consecutive_failures = consecutive_failures + 1
       WHERE id = ?`
    )
    .run(error, sensorId)
}

// ---------- readings ----------

export async function getReadings(
  sensorId: string,
  fromTs?: string,
  toTs?: string
): Promise<MetricReading[]> {
  const where = ['sensor_id = ?']
  const params: string[] = [sensorId]
  if (fromTs) {
    where.push('ts >= ?')
    params.push(fromTs)
  }
  if (toTs) {
    where.push('ts <= ?')
    params.push(toTs)
  }
  return getDb()
    .prepare(`SELECT ts, metric, value FROM readings WHERE ${where.join(' AND ')} ORDER BY ts`)
    .all(...params) as MetricReading[]
}

/** Most recent value of each metric for a sensor. */
export async function getLatestMetrics(sensorId: string): Promise<LatestMetric[]> {
  return getDb()
    .prepare(
      `SELECT metric, value, MAX(ts) AS ts FROM readings
       WHERE sensor_id = ? GROUP BY metric ORDER BY metric`
    )
    .all(sensorId) as LatestMetric[]
}

// ---------- config ----------

function getConfigValue(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

function setConfigValue(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}

/** Returns the stored API token, seeding it on first read from the
 *  SENSIFY_API_TOKEN env var (if set) or a generated random value. */
function ensureApiToken(): string {
  const stored = getConfigValue('apiToken')
  if (stored) return stored
  const token = process.env.SENSIFY_API_TOKEN || crypto.randomUUID().replace(/-/g, '')
  setConfigValue('apiToken', token)
  return token
}

export async function getConfig(): Promise<AppConfig> {
  return {
    temperatureUnit: (getConfigValue('temperatureUnit') as TemperatureUnit) ?? 'F',
    apiToken: ensureApiToken(),
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  setConfigValue('temperatureUnit', config.temperatureUnit)
  setConfigValue('apiToken', config.apiToken)
}
