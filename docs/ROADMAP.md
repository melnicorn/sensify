# Roadmap ideas

Notes from a July 2026 planning discussion: if Sensify grows into a small OSS
project other people actually run, where does it make sense to go — and where
should it deliberately stop? Nothing here is committed; it's a menu, not a
plan. Pick and choose.

## The identity

Sensify's niche is the middle ground between "SSH in and cat a CSV" and
Home Assistant: people want their sensor graphs and a ping when the wash is
done, without adopting a home-automation OS. The closest success story to
study is [Uptime Kuma](https://uptimekuma.org/) — one container, one narrow
job done completely, a polished UI, and a huge menu of notification targets.
Sensify could credibly be "Uptime Kuma for sensor data."

Every idea below was filtered through three questions: *still one container +
SQLite? still zero-config for the happy path? still explainable in one
sentence?*

## Tier 1 — things real usage will force

Do these before growth, not after — they're the issues an outside user would
file in week one.

1. **Retention + rollups.** The README says "kept forever," which is a time
   bomb on an SD card: 10 sensors at 30s cadence is ~10M rows/year. Standard
   pattern: raw data for N days → hourly min/max/avg rollups for months →
   daily forever. The poller is the natural place to run compaction; the
   migrations system is ready for the rollup tables. This also *improves* the
   product — 30d/1y charts render from rollups instead of shipping tens of
   thousands of raw points to Recharts. Least flashy item on this list, most
   important.

2. **Generalize the push API.** Push devices can currently only send
   temperature/humidity while pull devices can record anything — an
   asymmetry that will be the first GitHub issue filed. Let push payloads
   carry arbitrary named metrics with optional units, through the same
   unit-normalization path pull fields already use.

3. **Poller heartbeat + "goes silent" alerts.** Two flavors of the same gap:
   if the poller process dies, alerting silently stops (the web UI should
   surface poller liveness and warn loudly), and the staleness trigger we
   scoped earlier ("no data for 15 min") is the most-wanted alert type in
   sensor networks — dead batteries outnumber interesting events. The engine
   was built for this; it's one new evaluator kind plus a heartbeat row.

4. **Optional dashboard password.** Zero auth is fine on a LAN, but OSS users
   will put it behind a reverse proxy on the internet, and "no auth" becomes
   a CVE-flavored issue title. One optional shared password (cookie
   session), documented reverse-proxy/Tailscale guidance. Full multi-user
   auth is explicitly not worth it.

5. **Backup button.** `VACUUM INTO` a snapshot, download from Settings,
   document restore. Cheap insurance for the "my SD card died" issue every
   Pi project eventually gets.

## Tier 2 — the adoption levers

6. **MQTT ingest.** The single biggest audience-widener. The DIY sensor
   world — Tasmota, ESPHome, Zigbee2MQTT — speaks MQTT natively. An MQTT
   subscriber in the poller (broker URL + topic → the same JSON-tree field
   picker pull devices already use) means hundreds of device types work with
   zero device-specific code. Philosophically identical to the existing
   generic JSON puller — a third transport, not a new concept.

7. **More notification channels, chosen carefully.** The channel driver
   interface was built for this. Add exactly two: **ntfy** (the self-hosted
   community's darling, trivial HTTP POST) and a **generic webhook** (JSON
   POST with a templated body). The webhook is the escape hatch that makes
   everything else possible — including
   [Apprise](https://frasermclean.com/posts/self-hosted-notifications-with-ntfy-and-apprise),
   which fans out to 110+ services, so Discord/Slack/email/SMS "support"
   comes via documentation rather than maintained drivers. Uptime Kuma
   maintains 90+ integrations directly; that's a maintenance treadmill a
   small project should refuse.

8. **Rooms/zones on the dashboard.** The metadata already exists in the
   schema (location, zone, floor, tags) — group the dashboard by it, filter
   by it. Pure win from data already being collected.

9. **README-as-product.** Screenshot/GIF of drag-to-fit alert creation
   (that's the demo-able wow moment — nobody else has it), a live demo
   instance with simulated data, docs promoted out of implementation logs
   into a real docs page. For OSS adoption this outranks most features.

## Tier 3 — genuinely nice, after the above

- **Event analytics.** `alert_events` already stores duration/peak/avg —
  "12 wash cycles this month, avg 47m" or kWh-per-cycle is a query plus a
  card, and it's the kind of thing people screenshot.
- **Overlay/compare charts** (two sensors on one axis) and a **pinboard home
  view** (favorite metrics from multiple sensors) — stop before this becomes
  a Grafana clone.
- **Digest messages** ("morning summary" via existing channels) and per-rule
  reminder pings for long-running events.
- **Prometheus `/metrics` endpoint.** Cheap, and lets the homelab crowd fold
  Sensify into existing Grafana setups without Sensify building dashboards
  for them.
- **PWA manifest** so it installs to a phone home screen.

## Deliberately refused (the "flashy" pile)

- **A scripting language for alerts** — the pattern/fit/backtest approach is
  the differentiator precisely because it isn't code.
- **Device-specific integration catalog** ("Shelly support," "Tuya
  support") — the generic JSON/MQTT path *is* the identity; a catalog is an
  infinite treadmill Home Assistant already won.
- **Multi-user accounts / RBAC, cloud sync, mobile apps** — instant
  complexity explosion, contradicts the one-container ethos.
- **Swapping SQLite for Influx/Timescale** — rollups solve the actual
  problem; the single-file DB is a feature people choose this project for.
- **"AI anomaly detection"** — the robust-stats pattern derivation is
  already the tasteful version of this; the buzzword version is undebuggable
  and erodes trust the first time it cries wolf.

## Suggested sequencing

Retention/rollups → staleness alerts + poller heartbeat → generalized push →
ntfy/webhook channels → MQTT → README/demo polish. The password and backup
button are small enough to slot in anywhere.

## Sources consulted

- [Uptime Kuma](https://uptimekuma.org/)
- [Self-hosted uptime monitoring 2026: Uptime Kuma and what to run around it](https://valebyte.com/en/blog/self-hosted-uptime-monitoring-2026-uptime-kuma-and-what-to-run-around-it/)
- [Handling time series data in SQLite: best practices](https://moldstud.com/articles/p-handling-time-series-data-in-sqlite-best-practices)
- [Self-hosted notifications with ntfy and Apprise](https://frasermclean.com/posts/self-hosted-notifications-with-ntfy-and-apprise)
- [Reasons to use Apprise instead of ntfy/Gotify](https://www.xda-developers.com/reasons-use-apprise-instead-of-ntfy-gotify/)
- [Zigbee2MQTT + Home Assistant integration guide](https://www.zigbee2mqtt.io/guide/usage/integrations/home_assistant.html)
- [Tasmota + Home Assistant / MQTT](https://tasmota.github.io/docs/Home-Assistant/)
