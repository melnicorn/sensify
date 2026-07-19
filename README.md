# Sensify

A lightweight, self-hosted dashboard for home sensor data. Sensify collects readings two ways:

- **Push** — devices (e.g. a Raspberry Pi Zero with a temperature/humidity sensor) POST readings to a simple token-authenticated HTTP API.
- **Pull** — Sensify polls any device on your network that exposes a JSON endpoint over HTTP (smart plugs, energy monitors, weather stations…) and records the fields you choose. No device-specific integrations required.

Data is stored in SQLite on a single volume, charted live in the web UI, and kept forever — no cloud, no accounts, no external services. It's small enough to run comfortably on a Raspberry Pi.

## Features

- **Interactive, Live-Updating Charts**: Live-updating charts with reload-free time range switching (1h / 24h / 7d / 30d), per-chart logarithmic/linear scale toggles, and click-and-drag chart zooming.
- **Smart Alert Builder**: Drag across a chart to select an example event, or choose a preset pattern (cycle, spike, dip, level shift) derived automatically from the sensor's own history. Review fitted parameters as an editable sentence, preview with a 7-day backtest, and receive notifications via Telegram.
- **Flexible Notification Control**: Toggle alerts on/off per event transition, and define delivery windows (allow/block mode hours in local time) to suppress notifications during quiet hours while still logging events.
- **Alert Management & Editing**: Create, pause/resume, edit, or delete existing rules from the UI. Saving updates the rule cleanly and resets its tracking state.
- **Per-Sensor Detail Pages**: View metadata (location, zone, floor, hardware, tags), active alert rules, recent alert event history, and a "Latest Readings" card that auto-refreshes matching the device's update cadence.
- **Generic Pull Devices**: Point at any local network JSON URL, test the connection visually with a JSON tree browser, tick the fields to record, set a poll interval — done.
- **Flexible Metrics**: Any numeric or boolean JSON field can become a metric, with optional display units and aliases.
- **Push API**: Push readings via token-authenticated POST requests with built-in interactive OpenAPI/Swagger docs at `/docs`.
- **Remote Config for Push**: Set desired reporting intervals in the UI, delivered to push devices in the response on their next POST.
- **Robust Polling**: Polling status, detailed error reporting, and automatic backoff for unreachable pull devices.
- **Export Data**: Export chart data as JSON (current view, a drag-selected time frame, or everything) for viewing or downloading.
- **Display Customization**: Light/dark theme and temperature unit conversion (°C / °F / K) with automatic normalization for recognized temperature unit labels (`degC`, `°F`, `kelvin`, etc.).

## Getting started (Docker)

Grab the production compose file from the [latest release](https://github.com/melnicorn/sensify/releases/latest) and start it:

```sh
curl -LO https://github.com/melnicorn/sensify/releases/latest/download/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
```

This starts three containers from the same Sensify image (published to GHCR for amd64 and arm64), plus a Mosquitto broker:

- **web** — the dashboard, on port `3010` by default (edit the compose file to change)
- **poller** — a background process that polls your pull devices
- **mqtt-ingest** — a background process that subscribes to the MQTT broker (see [MQTT](#mqtt))
- **mosquitto** — an [Eclipse Mosquitto](https://mosquitto.org/) MQTT broker on port `1883`

The three Sensify containers share a `sensor-data` volume holding the SQLite database, which is created automatically on first boot.

Open `http://<host>:3010`, then visit **Settings** to find your API token (auto-generated on first boot). Devices use this token to push readings.

### Upgrading

The `latest` tag is cached locally, so force a fresh pull when upgrading:

```sh
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

Only containers whose image actually changed are recreated; your data volume is untouched.

## Adding a pull device

1. Click **Add device** on the dashboard
2. Enter the device's JSON endpoint URL, e.g. a Shelly plug's `http://192.168.1.50/rpc/Switch.GetStatus?id=0`
3. Click **Test connection** — the device's JSON structure appears as a tree
4. Check the fields you want to record, give each a metric name and optional unit
5. Set a poll interval and save

The poller picks up new and edited devices within about 15 seconds. Polling can be paused/resumed from the sensor's detail page, which also shows the last successful poll and any errors.

## MQTT

Sensify runs an [Eclipse Mosquitto](https://mosquitto.org/) broker (the `mosquitto` service) so devices can publish telemetry over MQTT — the protocol Tasmota, ESPHome, Shelly, Zigbee2MQTT and friends already speak — without any device-specific integration code. The `mqtt-ingest` service subscribes to the broker and records readings, exactly like the poller does for pull devices.

### Adding an MQTT sensor

1. Point your device at the broker (address `1883`, the credentials below).
2. On the dashboard, **Add device → Browse MQTT topics**.
3. Click **Listen** and pick your device's topic from the list as messages arrive (retained values appear immediately; live ones as the device publishes).
4. Tick the numeric/boolean fields to record, name each metric (add a unit like `C` to get temperature normalization), name the sensor, and **Create sensor**.

`mqtt-ingest` picks up new and edited sensors within about 15 seconds and starts recording. Ingest can be paused/resumed from the sensor's detail page. Retained messages are dropped rather than recorded — they replay stale state on reconnect, which would otherwise fabricate a reading with a current timestamp.

### Credentials

The broker requires a username and password (anonymous access is off). Both default to `sensify` / `sensify`. Override them before pointing any device at the broker — set `MQTT_USERNAME` and `MQTT_PASSWORD` (for example in a `.env` file next to the compose file), then recreate the stack. The same values are what you enter into each device's MQTT settings.

### Security model

The broker listens on port `1883` in **plaintext — no TLS**. This is a deliberate, accepted trade-off for Sensify's deployment model: everything runs on your LAN, and remote access is expected to be via VPN (which makes you LAN-local), so nothing is exposed to the internet. **Do not forward port `1883` past your LAN.** TLS, WAN ingress, and remote auth are explicitly out of scope — if you need them, terminate them at a reverse proxy or VPN, not in Sensify.

The Mosquitto config and password file are generated inside the container from the environment variables above, so the compose file stays self-contained (nothing extra to download). The trade-off: there is no hand-editable `mosquitto.conf` on disk. If you need to customise the broker (extra listeners, ACLs, bridges), mount your own config over `/mosquitto/config/mosquitto.conf` instead.

## Pushing readings

POST temperature and/or humidity readings to `/api/v1/readings` with the token from Settings:

```sh
curl -X POST http://<host>:3010/api/v1/readings \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "sensorId": "dht22-living-room",
    "sensorName": "Living Room",
    "data": {
      "temperature": { "value": 22.5, "unit": "C" },
      "humidity": { "value": 48.2 }
    }
  }'
```

Sensors register themselves on first POST. Devices may also send a `meta` object (location, zone, floor, hardware, tags) to seed their metadata. Full interactive API docs live at `/docs`.

If the UI has set a desired reporting interval for the device, the response includes it:

```json
{ "id": "…", "timestamp": "…", "config": { "interval": 120 } }
```

## Alerts

Sensify can watch any metric and message you when something starts and when it finishes — a washing machine cycle, a humidity threshold, a freezer warming up.

1. In **Settings → Notification channels**, add a Telegram bot (token from [@BotFather](https://t.me/BotFather)) and the chat ID it should message, then hit **Test**.
2. Open a sensor, drag across the chart to select one example of the event (include some quiet time around it), and click **Create alert**. No example yet? Hit **New alert** and pick a pattern (cycle, spike, dip, level shift) — thresholds are derived from the sensor's own history using robust statistics, with a sensitivity slider. You can also write simple thresholds from scratch.
3. Sensify fits a trigger from the selection — threshold, smoothing, and debounce — and shows it as an editable sentence like *"Start when average over 2 min is > 8 W holding for 60 s; end when it stays ≤ 8 W for 3 min."*
4. The backtest strip replays the rule over the last 7 days so you can see exactly which events it would have caught before saving.

Alerts are edge-triggered state machines: one message when the event starts, one when it ends (with duration and peak), no repeats while values hover around the threshold. Dwell times debounce noisy signals, and a re-arm delay prevents back-to-back firing.

### Custom Delivery Windows (Quiet Hours)

You can specify a notification delivery window for each alert rule. Choose between:
- **Always** notify immediately on transition.
- **Allow** delivery only during a specific hour span (e.g., `08:00` to `22:00`).
- **Block** delivery during a specific hour span (e.g., mute nighttime alerts from `22:00` to `07:00`).

Even when notifications are blocked or muted, the alert engine continues to run, evaluate readings, and log events in the history database.

### Alert Management

- **Editing**: Click **Edit** on any rule to open the alert wizard with its current parameters. Saving an edited rule restarts its tracking state machine cleanly (closing any in-progress events quietly).
- **Monitoring**: Toggle individual notifications on/off per transition (e.g. only notify on start), or pause/resume the rule entirely.
- **Logs**: View a history of recent events across all sensors on the global **Alerts** page, or filter to a single sensor's history directly on its detail page.

Message templates support `{sensor}`, `{metric}`, `{value}`, `{min}`, `{max}`, `{avg}`, `{duration}`, and `{started_at}`.

## Running from source

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev         # web UI on http://localhost:3000
pnpm poller:dev  # poller, in a second terminal (only needed for pull devices)
pnpm ingest:dev  # mqtt-ingest, in a third terminal (only needed for MQTT sensors)
```

These are three separate processes, like the three Docker containers. `pnpm dev`
alone runs the dashboard but records nothing from pull or MQTT devices — the
`poller` and `mqtt-ingest` processes are what write those readings. Run exactly
one `mqtt-ingest` (a second instance double-records every message). It connects
to `MQTT_URL` (default `mqtt://localhost:1883`); see [MQTT](#mqtt).

All processes share a SQLite database at `./data/sensify.db` (override the location with the `DATA_DIR` environment variable).

To build images locally instead of pulling from GHCR:

```sh
docker compose up --build
```
