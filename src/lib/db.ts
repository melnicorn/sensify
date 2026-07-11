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
]

function migrate(database: Database.Database): void {
  const current = database.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    const apply = database.transaction(() => {
      database.exec(MIGRATIONS[v]!)
      database.pragma(`user_version = ${v + 1}`)
    })
    apply()
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
