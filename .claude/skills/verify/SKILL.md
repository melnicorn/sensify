---
name: verify
description: Build, run, and drive Sensify locally to verify changes end-to-end
---

# Verifying Sensify changes

## Launch

```bash
pnpm install
DATA_DIR=$SCRATCH/data SENSIFY_API_TOKEN=testtoken pnpm dev --port 3100
```

The SQLite schema is created by migrations on the first request; `DATA_DIR`
isolates the database, and `SENSIFY_API_TOKEN` seeds the ingest bearer token
so you can POST readings immediately. The poller (`pnpm poller`) is a separate
process — without it, pull devices don't poll and the alert sweeper doesn't
run, so dwell/cooldown only advance when new readings arrive.

## Seed data

Create a push sensor through the real API:

```bash
curl -X POST http://localhost:3100/api/v1/readings \
  -H "Authorization: Bearer testtoken" -H "Content-Type: application/json" \
  -d '{"sensorId":"test-sensor","sensorName":"Living Room","data":{"temperature":{"value":21.5,"unit":"C"},"humidity":{"value":45}}}'
```

For history (charts, backtests) insert directly with `node -e` +
`better-sqlite3` from the repo's node_modules into the `readings` table
(temperatures in canonical °C). Alert rules/events can be inserted into
`alert_rules` / `alert_events` the same way — definitions are JSON validated
by `src/lib/alerts/schemas.ts`.

Alert notifications with no channels configured still log to the dev-server
stdout as `[alert:start] <rule name>: <message>` — grep the server log to
verify engine behavior.

## Drive the UI

Playwright is installed globally (`/opt/node22/lib/node_modules/playwright`,
not in the repo). Symlink it into a scratch `node_modules/` and launch with
`executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
(the bare `/opt/pw-browsers/chromium` path is a directory, not the binary).

Gotchas:
- Playwright touch emulation (`devices['iPhone 13']` + `touchscreen.tap`)
  does NOT synthesize the mouse-compat events real mobile browsers fire, so
  recharts tooltips/drag never trigger. Use `page.mouse` on a desktop
  viewport to exercise chart hover/tap/drag paths.
- HeroUI modal slots are addressable as `[data-slot="modal-body"]`,
  `[data-slot="modal-dialog"]` for scroll assertions.
