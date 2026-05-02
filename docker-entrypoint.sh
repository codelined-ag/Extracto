#!/bin/sh
set -eu

export DATABASE_URL="${DATABASE_URL:-file:/app/data/custom.db}"
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export MIGRATE_ON_START="${MIGRATE_ON_START:-1}"
export AUTH_SECRET="${AUTH_SECRET:-}"
export AUTH_SECRET_FILE="${AUTH_SECRET_FILE:-/app/data/.auth_secret}"
MIN_AUTH_SECRET_LENGTH=32

DB_PATH="${DATABASE_URL#file:}"
DB_DIR="$(dirname "$DB_PATH")"

mkdir -p "$DB_DIR"

generate_auth_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
    return 0
  fi

  if command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    echo
    return 0
  fi

  return 1
}

if [ -z "${AUTH_SECRET}" ] && [ -f "${AUTH_SECRET_FILE}" ]; then
  AUTH_SECRET="$(tr -d '\r\n' < "${AUTH_SECRET_FILE}")"
  export AUTH_SECRET
fi

if [ -z "${AUTH_SECRET}" ]; then
  if GENERATED_SECRET="$(generate_auth_secret 2>/dev/null)"; then
    AUTH_SECRET="$GENERATED_SECRET"
    export AUTH_SECRET
    umask 077
    printf "%s\n" "$AUTH_SECRET" > "${AUTH_SECRET_FILE}"
    chmod 600 "${AUTH_SECRET_FILE}" 2>/dev/null || true
    echo "INFO: Generated persistent AUTH_SECRET at ${AUTH_SECRET_FILE}"
  fi
fi

if [ -z "${AUTH_SECRET}" ]; then
  echo "ERROR: AUTH_SECRET is missing and could not be generated." >&2
  exit 1
fi

if [ "${#AUTH_SECRET}" -lt "${MIN_AUTH_SECRET_LENGTH}" ]; then
  echo "ERROR: AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters." >&2
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  if [ -f "/app/db/custom.db" ]; then
    cp /app/db/custom.db "$DB_PATH"
  fi
fi

if [ "$MIGRATE_ON_START" = "1" ] || [ "$MIGRATE_ON_START" = "true" ]; then
  if [ -d /app/prisma/migrations ] && [ "$(ls -A /app/prisma/migrations 2>/dev/null | grep -v migration_lock.toml | wc -l)" -gt 0 ]; then
    bunx prisma migrate deploy
  else
    bun run db:push
  fi
fi

echo "Starting Next.js from server.js"
exec "$@"
