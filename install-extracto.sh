#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
USER_BIN_DIR="${HOME}/.local/bin"
EXTRACTO_BIN="${USER_BIN_DIR}/extracto"
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

run_step_allow_fail() {
  local label="$1"
  shift
  if run_step "$label" "$@"; then
    return 0
  fi
  warn "${label} failed, continuing."
  return 0
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  die "This action requires root privileges: $*"
}

require_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: ${cmd}"
}

append_extracto_block() {
  local rc_file="$1"
  [ -f "$rc_file" ] || touch "$rc_file"
  if grep -q '^# >>> extracto >>>$' "$rc_file"; then
    return 0
  fi

  cat >> "$rc_file" <<'EOF'
# >>> extracto >>>
export PATH="$HOME/.local/bin:$PATH"
alias extracto="$HOME/.local/bin/extracto"
# <<< extracto <<<
EOF
}

install_docker_linux() {
  if command -v docker >/dev/null 2>&1; then
    info "Docker already installed"
    return
  fi

  run_step "Installing Docker..." run_root bash -lc "curl -fsSL https://get.docker.com | sh"
  run_step "Enabling Docker service..." run_root systemctl enable --now docker
}

install_docker_macos() {
  if command -v docker >/dev/null 2>&1; then
    info "Docker already installed"
    return
  fi

  if ! command -v brew >/dev/null 2>&1; then
    die "Homebrew is required to install Docker Desktop on macOS (https://brew.sh)"
  fi

  run_step "Installing Docker Desktop..." brew install --cask docker
  run_step_allow_fail "Opening Docker Desktop..." open -a Docker
}

ensure_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    info "Docker Compose plugin already available"
    return
  fi

  if [[ "$(uname -s)" == "Linux" ]]; then
    run_step "Installing Docker Compose plugin..." run_root bash -lc "apt-get update && apt-get install -y docker-compose-plugin"
  else
    die "Docker Compose plugin missing. Start Docker Desktop and re-run installer."
  fi
}

install_ollama_linux() {
  if command -v ollama >/dev/null 2>&1; then
    info "Ollama already installed"
    return
  fi

  run_step "Installing Ollama..." run_root bash -lc "curl -fsSL https://ollama.com/install.sh | sh"
}

install_ollama_macos() {
  if command -v ollama >/dev/null 2>&1; then
    info "Ollama already installed"
    return
  fi

  if ! command -v brew >/dev/null 2>&1; then
    die "Homebrew is required to install Ollama on macOS (https://brew.sh)"
  fi

  run_step "Installing Ollama..." brew install ollama
}

start_ollama_if_needed() {
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    ok "Ollama is already running"
    return
  fi

  if [[ "$(uname -s)" == "Linux" ]]; then
    if systemctl list-unit-files 2>/dev/null | grep -q '^ollama\.service'; then
      run_step "Starting Ollama service..." run_root systemctl enable --now ollama
    else
      run_step_allow_fail "Starting Ollama background server..." bash -lc "nohup ollama serve >/tmp/ollama.log 2>&1 &"
    fi
  else
    if command -v brew >/dev/null 2>&1; then
      run_step_allow_fail "Starting Ollama service..." brew services start ollama
    fi
    run_step_allow_fail "Opening Ollama app..." open -a Ollama
  fi
}

wait_for_docker() {
  local attempts=45
  local sleep_seconds=2
  local frames='|/-\'
  local i=0
  local total_wait=$((attempts * sleep_seconds))

  for _ in $(seq 1 "$attempts"); do
    if docker info >/dev/null 2>&1; then
      printf "\r%s✔%s Waiting for Docker daemon... ready\n" "$C_GREEN" "$C_RESET"
      return 0
    fi

    printf "\r%s%s%s Waiting for Docker daemon... (%ss max)" "$C_CYAN" "${frames:i%4:1}" "$C_RESET" "$total_wait"
    i=$((i + 1))
    sleep "$sleep_seconds"
  done

  echo
  die "Docker daemon is not ready yet. Start Docker and rerun this installer."
}

install_extracto_command() {
  run_step "Preparing extracto command..." mkdir -p "$USER_BIN_DIR"
  run_step "Installing extracto command..." chmod +x "${PROJECT_DIR}/scripts/extracto.sh"
  run_step "Linking extracto command..." ln -snf "${PROJECT_DIR}/scripts/extracto.sh" "$EXTRACTO_BIN"
  run_step "Updating shell profile..." append_extracto_block "${HOME}/.bashrc"
  run_step "Updating shell profile..." append_extracto_block "${HOME}/.zshrc"
}

main() {
  require_command curl

  case "$(uname -s)" in
    Linux)
      install_docker_linux
      ;;
    Darwin)
      install_docker_macos
      ;;
    *)
      die "Unsupported OS. This installer currently supports Linux and macOS."
      ;;
  esac

  wait_for_docker
  ensure_docker_compose

  case "$(uname -s)" in
    Linux)
      install_ollama_linux
      ;;
    Darwin)
      install_ollama_macos
      ;;
  esac

  start_ollama_if_needed
  install_extracto_command

  info "Turning up Extracto..."
  "${EXTRACTO_BIN}" on

  ok "Installation complete."
  info "Use: extracto on | extracto off | extracto uninstall"
  info "If this shell does not recognize 'extracto', run: source ~/.bashrc (or ~/.zshrc)"
  info "Internal logs are stored in: ${LOG_DIR}"
}

main "$@"
