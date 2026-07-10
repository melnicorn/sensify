# Sensify

A lightweight, self-hosted dashboard for home sensor data. Sensify collects readings two ways:

- **Push** — devices (e.g. a Raspberry Pi Zero with a temperature/humidity sensor) POST readings to a simple token-authenticated HTTP API.
- **Pull** — Sensify polls any device on your network that exposes a JSON endpoint over HTTP (smart plugs, energy monitors, weather stations…) and records the fields you choose. No device-specific integrations required.

Data is stored in SQLite on a single volume, charted live in the web UI, and kept forever — no cloud, no accounts, no external services. It's small enough to run comfortably on a Raspberry Pi.

## Features

- Live-updating charts per sensor with 1h / 24h / 7d / 30d ranges
- Generic pull devices: point at a JSON URL, test the connection, tick the fields to record, set a poll interval — done
- Any numeric or boolean JSON field can become a metric, with optional display units
- Push API with OpenAPI docs (Swagger UI built in at `/docs`)
- Per-sensor metadata (location, zone, floor, hardware, tags)
- Remote config for push devices: set a reporting interval in the UI and it's delivered on the device's next POST
- Polling status, error reporting, and automatic backoff for unreachable devices
- Light/dark theme, temperature unit conversion (°C / °F / K)

## Getting started (Docker)

Grab the production compose file from the [latest release](https://github.com/melnicorn/sensify/releases/latest) and start it:

```sh
curl -LO https://github.com/melnicorn/sensify/releases/latest/download/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
```

This starts two containers from the same image (published to GHCR for amd64 and arm64):

- **web** — the dashboard, on port `3010` by default (edit the compose file to change)
- **poller** — a background process that polls your pull devices

Both share a `sensor-data` volume holding the SQLite database, which is created automatically on first boot.

Open `http://<host>:3010`, then visit **Settings** to find your API token (auto-generated on first boot). Devices use this token to push readings.

## Adding a pull device

1. Click **Add device** on the dashboard
2. Enter the device's JSON endpoint URL, e.g. a Shelly plug's `http://192.168.1.50/rpc/Switch.GetStatus?id=0`
3. Click **Test connection** — the device's JSON structure appears as a tree
4. Check the fields you want to record, give each a metric name and optional unit
5. Set a poll interval and save

The poller picks up new and edited devices within about 15 seconds. Polling can be paused/resumed from the sensor's detail page, which also shows the last successful poll and any errors.

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

## Running from source

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev         # web UI on http://localhost:3000
pnpm poller:dev  # poller, in a second terminal
```

Both processes share a SQLite database at `./data/sensify.db` (override the location with the `DATA_DIR` environment variable).

To build images locally instead of pulling from GHCR:

```sh
docker compose up --build
```
