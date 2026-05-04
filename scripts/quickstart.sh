#!/usr/bin/env bash
set -euo pipefail

IMAGE="${EXTRACTO_IMAGE:-ghcr.io/codelined-ag/extracto:latest}"
PORT="${EXTRACTO_PORT:-3000}"
NAME="${EXTRACTO_CONTAINER:-extracto}"
VOLUME="${EXTRACTO_VOLUME:-extracto-data}"
ALLOW_SIGNUP="${ALLOW_SIGNUP:-1}"
COOKIE_SECURE="${COOKIE_SECURE:-false}"
HEALTH_TIMEOUT="${EXTRACTO_HEALTH_TIMEOUT:-60}"

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_BLUE=""
fi
die()  { printf "%s✖%s %s\n" "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
info() { printf "%s•%s %s\n" "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf "%s✔%s %s\n" "$C_GREEN" "$C_RESET" "$*"; }

command -v docker >/dev/null 2>&1 || die "Docker is required. Install it from https://docs.docker.com/get-docker/ and re-run."
docker info >/dev/null 2>&1       || die "Docker daemon not running. Start it and re-run."

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32; return; fi
  if command -v python3 >/dev/null 2>&1; then python3 -c "import secrets; print(secrets.token_hex(32))"; return; fi
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; printf '\n'
}

if docker container inspect "$NAME" >/dev/null 2>&1; then
  info "Container '$NAME' exists. Starting it."
  docker start "$NAME" >/dev/null
else
  info "Pulling $IMAGE"
  docker pull "$IMAGE" >/dev/null
  info "Starting Extracto on port $PORT"
  docker run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -p "${PORT}:3000" \
    -v "${VOLUME}:/app/data" \
    -e "AUTH_SECRET=$(gen_secret)" \
    -e "ALLOW_SIGNUP=${ALLOW_SIGNUP}" \
    -e "COOKIE_SECURE=${COOKIE_SECURE}" \
    "$IMAGE" >/dev/null
fi

info "Waiting for healthcheck (up to ${HEALTH_TIMEOUT}s)..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
while true; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$NAME" 2>/dev/null || true)"
  case "$status" in
    healthy)
      ok "Extracto is up at http://localhost:${PORT}"
      ok "Open it in your browser and sign up. Once you have an operator account, set ALLOW_SIGNUP=0 to lock the door."
      exit 0
      ;;
    unhealthy)
      die "Container reported unhealthy. See: docker logs $NAME"
      ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    die "Container did not become healthy in ${HEALTH_TIMEOUT}s. See: docker logs $NAME"
  fi
  sleep 2
done
