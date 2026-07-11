// Deploy-safety test: a legacy production database (pre-versioning schema,
// user_version 0, existing data) must be adopted in place by the current
// migrations, including the unit_kind backfill and °F→°C data conversion.
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const dir = mkdtempSync(path.join(tmpdir(), 'sensify-migration-test-'))
process.env.DATA_DIR = dir

// The schema exactly as shipped before migrations existed (old db.ts)
const LEGACY_SCHEMA = `
CREATE TABLE sensors (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'push' CHECK (type IN ('push', 'pull')),
  name TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  last_ip TEXT,
  location TEXT,
  floor INTEGER,
  zone TEXT,
  description TEXT,
  hardware TEXT,
  tags TEXT,
  desired_interval INTEGER,
  url TEXT,
  poll_interval INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_success TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_sample TEXT
);
CREATE TABLE pull_fields (
  sensor_id TEXT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  metric TEXT NOT NULL,
  unit TEXT,
  PRIMARY KEY (sensor_id, metric)
);
CREATE TABLE readings (
  sensor_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX idx_readings_sensor_ts ON readings (sensor_id, ts);
CREATE INDEX idx_readings_sensor_metric_ts ON readings (sensor_id, metric, ts);
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

// Seed a legacy database before the app's db module ever touches it
const legacy = new Database(path.join(dir, 'sensify.db'))
legacy.exec(LEGACY_SCHEMA)
legacy
  .prepare(
    `INSERT INTO sensors (id, type, name, first_seen, last_seen, url, poll_interval)
     VALUES ('plug', 'pull', 'Plug', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'http://x/status', 30)`
  )
  .run()
legacy
  .prepare("INSERT INTO pull_fields (sensor_id, path, metric, unit) VALUES ('plug', 'apower', 'apower', 'W')")
  .run()
legacy
  .prepare("INSERT INTO pull_fields (sensor_id, path, metric, unit) VALUES ('plug', 'temp.tF', 'temp_f', 'degF')")
  .run()
legacy
  .prepare("INSERT INTO readings (sensor_id, ts, metric, value) VALUES ('plug', '2026-07-01T00:00:00.000Z', 'temp_f', 212.0)")
  .run()
legacy
  .prepare("INSERT INTO readings (sensor_id, ts, metric, value) VALUES ('plug', '2026-07-01T00:00:00.000Z', 'apower', 42.0)")
  .run()
legacy.close()

const { getDb } = await import('./db')

describe('migrating a legacy production database', () => {
  const db = getDb()

  it('adopts the schema at the current version', () => {
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(3)
  })

  it('preserves existing rows', () => {
    expect(db.prepare('SELECT COUNT(*) c FROM sensors').get()).toEqual({ c: 1 })
    expect(db.prepare('SELECT COUNT(*) c FROM readings').get()).toEqual({ c: 2 })
  })

  it('backfills unit_kind from legacy unit labels', () => {
    const rows = db
      .prepare('SELECT metric, unit_kind FROM pull_fields ORDER BY metric')
      .all() as { metric: string; unit_kind: string | null }[]
    expect(rows).toEqual([
      { metric: 'apower', unit_kind: null },
      { metric: 'temp_f', unit_kind: 'temperature' },
    ])
  })

  it('converts historic °F readings to canonical °C, leaving others alone', () => {
    const temp = db
      .prepare("SELECT value FROM readings WHERE metric = 'temp_f'")
      .get() as { value: number }
    expect(temp.value).toBeCloseTo(100) // 212°F
    const power = db
      .prepare("SELECT value FROM readings WHERE metric = 'apower'")
      .get() as { value: number }
    expect(power.value).toBe(42)
  })

  it('creates the alerting tables', () => {
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[]
    ).map((t) => t.name)
    for (const t of ['channels', 'alert_rules', 'alert_rule_channels', 'alert_rule_state', 'alert_events']) {
      expect(tables).toContain(t)
    }
  })

  it('leaves the file at a stable version a second connection can use as-is', () => {
    // Simulates the second container (web/poller race loser) opening the
    // already-migrated file: version is final, schema queryable
    const second = new Database(path.join(dir, 'sensify.db'))
    expect(second.pragma('user_version', { simple: true })).toBe(
      db.pragma('user_version', { simple: true })
    )
    expect(() => second.prepare('SELECT COUNT(*) FROM alert_rules').get()).not.toThrow()
    second.close()
  })
})
