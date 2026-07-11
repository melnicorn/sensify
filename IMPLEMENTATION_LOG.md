# Alerts feature — implementation log

Branch: `feature/alerts`. One commit per step; each commit typechecks and runs
on its own, so any step is a safe rollback point.

Related work committed to `main` just before this branch:

- `73968eb` — JSON export (view/download; range, drag-selection, or all data), numeric time axis + chart drag selection
- `399f76b` — Chart auto-refresh adapts to device cadence and selected range

## Steps

| # | Commit | Feature |
|---|--------|---------|
| 1 | `00a8202` | Migration helper: `PRAGMA user_version` versioned migrations in `src/lib/db.ts`; baseline schema becomes migration 1 (idempotent for existing deployments) |
| 2 | `7f129c7` | Unit registry + normalization: alias table (`degC`/`°C`/… → canonical), `pull_fields.unit_kind`, temperature pull metrics stored °C and converted for display |
| 3 | `26f8159` | Alert data layer: `channels`, `alert_rules`, `alert_rule_channels`, `alert_rule_state`, `alert_events` tables + CRUD repo + Zod definition schema (v1 `level` trigger) |
| 4 | `58a4e93` | Alert engine: pure state-machine core (`machine.ts`), `level` evaluator, ingest hook (push + pull share one code path), poller sweeper; verified by replaying the captured wash cycle (one start, one end) |
| 5 | `249c9da` | Telegram channel driver + notification dispatch from engine transitions; per-channel delivery status |
| 6 | `04d3918` | Notification channels admin UI in Settings (create/edit/delete/test-send) |
| 7 | `8071caf` | Fit + backtest library: selection → fitted rule params (baseline-edge trimming); rule + history → detected events via the exact engine core |
| 8 | `666cd6d` | Create-alert wizard: drag selection → editable sentence → 7-day backtest strip → channels → save; auto-picks the best-fitting metric |
| 9 | `97c4edc` | Alerts management UI: `/alerts` page (rules + event history), per-sensor alerts card, pause/resume/delete |
| 10 | `87cf426` | Docs (README alerts section, feature bullets), manual "New alert" path (no selection needed, e.g. plain humidity thresholds), wizard edit-clobber guard; live E2E: mock device → poller → engine → real Telegram delivery confirmed |
| 11 | HEAD | Vitest test suite (49 tests): machine core, fit/backtest against the captured wash-cycle fixture, unit registry, JSON paths, rule descriptions, and engine integration on a real temp SQLite DB; wired into CI before build |

## Notes

- Rule definitions are versioned JSON (`{"v":1, "trigger":{"kind":"level",…}}`) — new
  trigger kinds extend the `kind` discriminated union in `src/lib/alerts/schemas.ts`
  plus an evaluator; the lifecycle/notification machinery is shared.
- Runtime state (`alert_rule_state`) is written on phase transitions only and is
  keyed to `alert_rules.updated_at`, so editing a rule resets it cleanly.
- Temperatures are canonical °C everywhere (storage, thresholds); display converts.
