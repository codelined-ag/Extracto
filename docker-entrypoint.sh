#!/bin/sh
set -eu

export DATABASE_URL="${DATABASE_URL:-file:/app/data/custom.db}"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export MIGRATE_ON_START="${MIGRATE_ON_START:-1}"
export AUTH_SECRET="${AUTH_SECRET:-}"

if [ "${NODE_ENV:-}" = "production" ] && [ -z "${AUTH_SECRET}" ]; then
  echo "ERROR: AUTH_SECRET must be set when NODE_ENV=production." >&2
  echo "Set AUTH_SECRET in docker.env or pass it as an environment variable." >&2
  exit 1
fi

DB_PATH="${DATABASE_URL#file:}"
DB_DIR="$(dirname "$DB_PATH")"

mkdir -p "$DB_DIR"

if [ ! -f "$DB_PATH" ]; then
  if [ -f "/app/db/custom.db" ]; then
    cp /app/db/custom.db "$DB_PATH"
  fi
fi

if [ "$MIGRATE_ON_START" = "1" ] || [ "$MIGRATE_ON_START" = "true" ]; then
  bun run db:push
fi

echo "Starting Next.js from server.js"
exec "$@"
