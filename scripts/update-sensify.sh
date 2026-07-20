#!/usr/bin/env bash
# Update Sensify on this host: fetch the latest release compose file, pull new
# images, recreate the containers, and clean up superseded image layers.
#
#   ./update-sensify.sh              # normal update (backs up the DB first)
#   BACKUP=0 ./update-sensify.sh     # skip the backup
#   SENSIFY_DIR=/srv/sensify ./update-sensify.sh
set -euo pipefail

cd "${SENSIFY_DIR:-$HOME}"

COMPOSE_FILE=docker-compose.prod.yml
URL="https://github.com/melnicorn/sensify/releases/latest/download/${COMPOSE_FILE}"
STAMP="$(date +%F-%H%M)"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "No $COMPOSE_FILE in $(pwd). Set SENSIFY_DIR to where it lives." >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "!! No .env here — MQTT credentials will fall back to sensify/sensify."
fi

# --- 1. Back up the database ------------------------------------------------
# Booting applies any new schema migrations, so snapshot the volume first.
if [ "${BACKUP:-1}" = "1" ]; then
  echo "==> Backing up the database volume"
  VOL="$(docker volume ls -q --filter name=sensor-data | head -1)"
  if [ -n "$VOL" ]; then
    docker run --rm -v "$VOL":/data -v "$PWD":/backup alpine \
      tar czf "/backup/sensify-backup-${STAMP}.tar.gz" -C /data .
    echo "    saved sensify-backup-${STAMP}.tar.gz"
  else
    echo "    !! no sensor-data volume found — skipping backup"
  fi
fi

# --- 2. Fetch the latest compose file ---------------------------------------
# Download to a temp file first: a failed or truncated download must never
# replace a working config. A stale file looks exactly like a broken update.
echo "==> Fetching the latest compose file"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP"
[ -s "$TMP" ] || { echo "Downloaded file is empty — aborting." >&2; exit 1; }

if cmp -s "$TMP" "$COMPOSE_FILE"; then
  echo "    already current"
else
  cp "$COMPOSE_FILE" "${COMPOSE_FILE}.bak"
  cp "$TMP" "$COMPOSE_FILE"
  if compose config -q; then
    echo "    updated (previous saved as ${COMPOSE_FILE}.bak)"
  else
    echo "!! New compose file is invalid — restoring the previous one." >&2
    mv "${COMPOSE_FILE}.bak" "$COMPOSE_FILE"
    exit 1
  fi
fi

# --- 3. Pull images and recreate --------------------------------------------
echo "==> Pulling images"
compose pull

echo "==> Recreating containers"
compose up -d

# --- 4. Clean up ------------------------------------------------------------
# Dangling images only: the layers the pull just superseded. Use `-a` instead
# to also drop images no container currently references.
echo "==> Pruning superseded images"
docker image prune -f

echo "==> Status"
compose ps
echo
echo "Done. Recent ingest log:"
compose logs --tail=10 mqtt-ingest || true
