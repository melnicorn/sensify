import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')

let db: Database.Database | null = null

const SCHEMA = `
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
`

export function getDb(): Database.Database {
  if (db) return db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  db = new Database(path.join(DATA_DIR, 'sensify.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
