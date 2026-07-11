import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')

let db: Database.Database | null = null

// Versioned migrations tracked via PRAGMA user_version. Each entry runs once,
// in order, inside a transaction. Never edit an entry after it has shipped —
// append a new one. Migration 1 uses IF NOT EXISTS because it describes the
// schema that existed before versioning (deployed DBs report user_version 0).
const MIGRATIONS: string[] = [
  // 1: baseline schema
  `
CREATE TABLE IF NOT EXISTS sensors (
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

CREATE TABLE IF NOT EXISTS pull_fields (
  sensor_id TEXT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  metric TEXT NOT NULL,
  unit TEXT,
  PRIMARY KEY (sensor_id, metric)
);

CREATE TABLE IF NOT EXISTS readings (
  sensor_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_readings_sensor_ts ON readings (sensor_id, ts);
CREATE INDEX IF NOT EXISTS idx_readings_sensor_metric_ts ON readings (sensor_id, metric, ts);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  // 2: unit normalization. pull_fields.unit_kind marks fields whose unit label
  // resolves to a known dimension; temperature readings become canonical °C.
  // The label-normalization SQL mirrors parseUnitLabel() in units.ts.
  `
ALTER TABLE pull_fields ADD COLUMN unit_kind TEXT;

UPDATE pull_fields SET unit_kind = 'temperature'
WHERE lower(replace(replace(replace(replace(trim(unit), '°', ''), 'degrees', 'deg'), 'degree', 'deg'), ' ', ''))
  IN ('c', 'f', 'k', 'degc', 'degf', 'degk', 'celsius', 'fahrenheit', 'kelvin');

UPDATE readings SET value = (value - 32.0) * 5.0 / 9.0
WHERE EXISTS (
  SELECT 1 FROM pull_fields pf
  WHERE pf.sensor_id = readings.sensor_id AND pf.metric = readings.metric
    AND pf.unit_kind = 'temperature'
    AND lower(replace(replace(trim(pf.unit), '°', ''), ' ', '')) IN ('f', 'degf', 'fahrenheit')
);

UPDATE readings SET value = value - 273.15
WHERE EXISTS (
  SELECT 1 FROM pull_fields pf
  WHERE pf.sensor_id = readings.sensor_id AND pf.metric = readings.metric
    AND pf.unit_kind = 'temperature'
    AND lower(replace(replace(trim(pf.unit), '°', ''), ' ', '')) IN ('k', 'degk', 'kelvin')
);
`,
  // 3: alerting. Rule definitions are versioned JSON (see src/lib/alerts);
  // runtime state lives in alert_rule_state and is written only on phase
  // transitions. alert_events is the per-event history log.
  `
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  last_ok_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  sensor_id TEXT NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  definition TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_alert_rules_sensor ON alert_rules (sensor_id);

CREATE TABLE alert_rule_channels (
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, channel_id)
);

CREATE TABLE alert_rule_state (
  rule_id TEXT PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
  phase TEXT NOT NULL DEFAULT 'idle',
  phase_since TEXT NOT NULL,
  event_id TEXT,
  rule_updated_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE alert_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  stats TEXT
);
CREATE INDEX idx_alert_events_rule ON alert_events (rule_id, started_at);
`,
]

function migrate(database: Database.Database): void {
  // The web and poller processes both open the database at boot. Each step
  // takes a write lock (BEGIN IMMEDIATE) and re-reads user_version inside it,
  // so whichever process loses the race skips the already-applied migration
  // instead of failing on e.g. a duplicate ALTER TABLE.
  for (;;) {
    const applied = database.transaction((): boolean => {
      const v = database.pragma('user_version', { simple: true }) as number
      if (v >= MIGRATIONS.length) return false
      database.exec(MIGRATIONS[v]!)
      database.pragma(`user_version = ${v + 1}`)
      return true
    }).immediate()
    if (!applied) break
  }
}

export function getDb(): Database.Database {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(path.join(DATA_DIR, 'sensify.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}
