#!/usr/bin/env bash
set -euo pipefail

resolve_source_path() {
  local source="${BASH_SOURCE[0]}"
  while [ -L "$source" ]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    if [[ "$source" != /* ]]; then
      source="$dir/$source"
    fi
  done
  cd -P "$(dirname "$source")" && pwd
}

SCRIPT_DIR="$(resolve_source_path)"
PROJECT_DIR="${EXTRACTO_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd -P)}"
USER_BIN="${HOME}/.local/bin/extracto"
LOG_DIR="${EXTRACTO_LOG_DIR:-$HOME/.local/state/extracto/logs}"
if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_DIR="/tmp/extracto/logs"
  mkdir -p "$LOG_DIR"
fi

if [ -t 1 ]; then
  C_RESET=$'\033[0m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_CYAN=$'\033[36m'
else
  C_RESET=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_BLUE=""
  C_CYAN=""
fi

die() {
  printf "%s✖%s %s\n" "$C_RED" "$C_RESET" "$*" >&2
  exit 1
}

info() {
  printf "%s•%s %s\n" "$C_BLUE" "$C_RESET" "$*"
}

ok() {
  printf "%s✔%s %s\n" "$C_GREEN" "$C_RESET" "$*"
}

warn() {
  printf "%s!%s %s\n" "$C_YELLOW" "$C_RESET" "$*"
}

ensure_project() {
  [ -f "${PROJECT_DIR}/docker-compose.yml" ] || die "docker-compose.yml not found at ${PROJECT_DIR}"
  [ -f "${PROJECT_DIR}/docker.env" ] || die "docker.env not found at ${PROJECT_DIR}"
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
}

compose() {
  (cd "${PROJECT_DIR}" && docker compose --env-file docker.env "$@")
}

remove_extracto_block() {
  local rc_file="$1"
  [ -f "$rc_file" ] || return 0
  if ! grep -q '^# >>> extracto >>>$' "$rc_file"; then
    return 0
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  awk '
    BEGIN { skip = 0 }
    /^# >>> extracto >>>$/ { skip = 1; next }
    /^# <<< extracto <<<$/{ skip = 0; next }
    skip == 0 { print }
  ' "$rc_file" > "$tmp_file"
  mv "$tmp_file" "$rc_file"
}

slugify() {
  echo "$1" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-' | sed 's/^-//;s/-$//'
}

spinner_wait() {
  local pid="$1"
  local label="$2"
  local frames='|/-\'
  local i=0

  while kill -0 "$pid" 2>/dev/null; do
    printf "\r%s%s%s %s" "$C_CYAN" "${frames:i%4:1}" "$C_RESET" "$label"
    i=$((i + 1))
    sleep 0.1
  done
}

run_step() {
  local label="$1"
  shift
  local log_file="$LOG_DIR/$(date +%s%N)-$(slugify "$label").log"

  ("$@" >"$log_file" 2>&1) &
  local pid=$!
  spinner_wait "$pid" "$label"

  local rc
  if wait "$pid"; then
    rc=0
  else
    rc=$?
  fi

  if [ "$rc" -eq 0 ]; then
    printf "\r%s✔%s %s\n" "$C_GREEN" "$C_RESET" "$label"
    return 0
  fi

  printf "\r%s✖%s %s\n" "$C_RED" "$C_RESET" "$label"
  warn "Command log: $log_file"
  return "$rc"
}

cmd_on() {
  ensure_project
  run_step "Turning up Extracto..." compose up -d --build
  run_step "Checking Extracto health..." compose ps
  ok "Extracto is running at http://localhost:3000"
}

cmd_off() {
  ensure_project
  run_step "Shutting down Extracto..." compose down
  ok "Extracto is shut down"
}

cmd_uninstall() {
  ensure_project
  run_step "Removing Extracto containers and volumes..." compose down -v --remove-orphans
  run_step "Removing shell alias blocks..." remove_extracto_block "${HOME}/.bashrc"
  run_step "Removing shell alias blocks..." remove_extracto_block "${HOME}/.zshrc"

  if [ -L "$USER_BIN" ]; then
    run_step "Removing extracto command..." rm -f "$USER_BIN"
  fi

  ok "Extracto has been uninstalled"
  info "Ollama was kept installed as requested"
}

print_help() {
  cat <<EOF
Usage: extracto <command>

Commands:
  on         Start Extracto (quiet mode with animated status)
  off        Stop Extracto (quiet mode with animated status)
  uninstall  Remove Extracto command and app resources (keeps Ollama)

Logs:
  Internal command logs are saved to: ${LOG_DIR}
EOF
}

main() {
  local command="${1:-}"
  case "$command" in
    on)
      cmd_on
      ;;
    off)
      cmd_off
      ;;
    uninstall)
      cmd_uninstall
      ;;
    -h|--help|help|"")
      print_help
      ;;
    *)
      die "unknown command '${command}'. Run 'extracto --help'."
      ;;
  esac
}

main "$@"
