# Alerts feature — implementation log

Branch: `feature/alerts`. One commit per step; each commit typechecks and runs
on its own, so any step is a safe rollback point. Commit hashes are backfilled
in the final docs commit (see `git log feature/alerts` in the meantime).

Related work committed to `main` just before this branch:

- `73968eb` — JSON export (view/download; range, drag-selection, or all data), numeric time axis + chart drag selection
- `399f76b` — Chart auto-refresh adapts to device cadence and selected range

## Steps

| # | Commit | Feature |
|---|--------|---------|
| 1 | _pending_ | Migration helper: `PRAGMA user_version` versioned migrations in `src/lib/db.ts`; baseline schema becomes migration 1 (idempotent for existing deployments) |
| 2 | _pending_ | Unit registry + normalization: alias table (`degC`/`°C`/… → canonical), `pull_fields.unit_kind`, temperature pull metrics stored °C and converted for display |
| 3 | _pending_ | Alert data layer: `channels`, `alert_rules`, `alert_rule_channels`, `alert_rule_state`, `alert_events` tables + CRUD repo + Zod definition schema (v1 `level` trigger) |
| 4 | _pending_ | Alert engine: pure state-machine core, `level` evaluator, ingest hook (push + pull), poller sweeper; log-only notifications; replay script |
| 5 | _pending_ | Telegram channel driver + notification dispatch from engine transitions |
| 6 | _pending_ | Notification channels admin UI (create/edit/delete/test-send) |
| 7 | _pending_ | Fit + backtest library: selection → fitted rule params; rule + history → detected events |
| 8 | _pending_ | Create-alert wizard: drag selection → sentence chips → backtest strip → channels → save |
| 9 | _pending_ | Alerts management UI: per-sensor panel, rules list, event history, enable/disable |
| 10 | _pending_ | Docs + end-to-end verification (replayed wash cycle through live poller) |
