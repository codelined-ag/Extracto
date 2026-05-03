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
RUNTIME_ENV_FILE="${PROJECT_DIR}/.extracto.env"
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

generate_auth_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
    return
  fi

  if command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    echo
    return
  fi

  die "Unable to generate AUTH_SECRET (missing openssl/python3/od)"
}

env_file_auth_secret() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  awk -F= '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*AUTH_SECRET[[:space:]]*=/ {
      val = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
      gsub(/^"|"$/, "", val)
      gsub(/^'\''|'\''$/, "", val)
      print val
      exit
    }
  ' "$env_file"
}

ensure_auth_secret() {
  local current="${AUTH_SECRET:-}"
  if [ -n "$current" ]; then
    return 0
  fi

  local docker_env_secret
  docker_env_secret="$(env_file_auth_secret "${PROJECT_DIR}/docker.env")"
  if [ -n "$docker_env_secret" ]; then
    return 0
  fi

  local runtime_secret
  runtime_secret="$(env_file_auth_secret "$RUNTIME_ENV_FILE")"
  if [ -n "$runtime_secret" ]; then
    return 0
  fi

  local generated
  generated="$(generate_auth_secret)"
  [ -n "$generated" ] || die "Generated AUTH_SECRET is empty"
  umask 077
  printf "AUTH_SECRET=%s\n" "$generated" > "$RUNTIME_ENV_FILE"
  ok "Generated local AUTH_SECRET in ${RUNTIME_ENV_FILE}"
}

compose() {
  local compose_args=(docker compose --env-file docker.env)
  if [ -f "$RUNTIME_ENV_FILE" ]; then
    compose_args+=(--env-file "$RUNTIME_ENV_FILE")
  fi

  (cd "${PROJECT_DIR}" && "${compose_args[@]}" "$@")
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
  ensure_auth_secret
  run_step "Turning up Extracto..." compose up -d --build
  run_step "Checking Extracto health..." compose ps
  ok "Extracto is running at http://localhost:3000"
}

cmd_off() {
  ensure_project
  run_step "Shutting down Extracto..." compose down
  ok "Extracto is shut down"
}

cmd_api_key() {
  ensure_project
  local sub="${1:-}"
  [ -n "$sub" ] || die "usage: extracto api-key <create|list|revoke> [args...]"
  shift
  compose exec -T app sh -c '
    if [ -z "${AUTH_SECRET:-}" ] && [ -f /app/data/.auth_secret ]; then
      AUTH_SECRET="$(tr -d "\r\n" < /app/data/.auth_secret)"
      export AUTH_SECRET
    fi
    exec bun run scripts/api-key-cli.ts "$@"
  ' -- "$sub" "$@"
}

# ----------------------------------------------------------------------
# HTTP API helpers — talk to the running Extracto instance
# ----------------------------------------------------------------------

EXTRACTO_URL_DEFAULT="${EXTRACTO_URL:-http://127.0.0.1:3000}"

resolve_token() {
  if [ -n "${EXTRACTO_TOKEN:-}" ]; then
    printf "%s" "$EXTRACTO_TOKEN"
    return
  fi
  if [ -f "${HOME}/.extracto/config" ]; then
    grep -E "^EXTRACTO_TOKEN=" "${HOME}/.extracto/config" 2>/dev/null \
      | tail -1 | cut -d= -f2- | tr -d '"'
  fi
}

require_token() {
  local tok
  tok="$(resolve_token)"
  if [ -z "$tok" ]; then
    die "no API token found. Set EXTRACTO_TOKEN, or run 'extracto api-key create <email> <name>' and store the result in ~/.extracto/config as EXTRACTO_TOKEN=<key>."
  fi
  printf "%s" "$tok"
}

api_get() {
  # api_get <path> [query]
  local path="$1"
  local token
  token="$(require_token)"
  curl -fsS \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/json" \
    "${EXTRACTO_URL_DEFAULT}${path}"
}

api_post_json() {
  # api_post_json <path> <json-body>
  local path="$1"
  local body="$2"
  local token
  token="$(require_token)"
  curl -fsS -X POST \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$body" \
    "${EXTRACTO_URL_DEFAULT}${path}"
}

api_delete() {
  local path="$1"
  local token
  token="$(require_token)"
  curl -fsS -X DELETE \
    -H "Authorization: Bearer ${token}" \
    "${EXTRACTO_URL_DEFAULT}${path}"
}

# ----------------------------------------------------------------------
# New commands
# ----------------------------------------------------------------------

cmd_status() {
  ensure_project
  compose ps
}

cmd_logs() {
  ensure_project
  compose logs -f app
}

cmd_jobs() {
  local sub="${1:-list}"
  shift || true
  case "$sub" in
    list)
      local limit="${1:-20}"
      api_get "/api/jobs?limit=${limit}"
      ;;
    get)
      [ -n "${1:-}" ] || die "usage: extracto jobs get <job-id>"
      api_get "/api/jobs/${1}"
      ;;
    delete)
      [ -n "${1:-}" ] || die "usage: extracto jobs delete <job-id>"
      api_delete "/api/jobs/${1}"
      ;;
    cancel)
      [ -n "${1:-}" ] || die "usage: extracto jobs cancel <job-id>"
      api_post_json "/api/jobs/${1}/control" '{"action":"stop"}'
      ;;
    wait)
      [ -n "${1:-}" ] || die "usage: extracto jobs wait <job-id>"
      local id="$1"
      local status="QUEUED"
      while [ "$status" = "QUEUED" ] || [ "$status" = "RUNNING" ]; do
        sleep 2
        local body
        body="$(api_get "/api/jobs/${id}")" || die "failed to fetch job ${id}"
        status="$(printf "%s" "$body" | grep -oE '"status":"[A-Z]+"' | head -1 | cut -d'"' -f4)"
        info "  status=${status}"
      done
      printf "%s\n" "$body"
      ;;
    *)
      die "usage: extracto jobs <list|get|delete|cancel|wait> [args...]"
      ;;
  esac
}

cmd_presets() {
  local sub="${1:-list}"
  shift || true
  case "$sub" in
    list)
      api_get "/api/v1/presets"
      ;;
    create)
      local name="${1:-}"
      local instruction="${2:-}"
      local format="${3:-markdown}"
      [ -n "$name" ] && [ -n "$instruction" ] || \
        die "usage: extracto presets create <name> <instruction> [markdown|json]"
      api_post_json "/api/v1/presets" \
        "$(printf '{"name":%s,"instruction":%s,"outputFormat":%s}' \
          "$(printf '%s' "$name" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
          "$(printf '%s' "$instruction" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
          "$(printf '%s' "$format" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
      ;;
    delete)
      [ -n "${1:-}" ] || die "usage: extracto presets delete <preset-id>"
      api_delete "/api/v1/presets/${1}"
      ;;
    *)
      die "usage: extracto presets <list|create|delete> [args...]"
      ;;
  esac
}

cmd_settings() {
  local sub="${1:-get}"
  shift || true
  case "$sub" in
    get)
      api_get "/api/settings"
      ;;
    *)
      die "usage: extracto settings get   (use the web UI to change settings)"
      ;;
  esac
}

cmd_ocr() {
  local file="${1:-}"
  [ -n "$file" ] || die "usage: extracto ocr <file> --model NAME [--out PATH] [--no-wait]"
  [ -f "$file" ] || die "file not found: $file"
  local out="" model="" wait_flag=1
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --model)
        model="${2:-}"; shift 2
        ;;
      --out)
        out="${2:-}"; shift 2
        ;;
      --no-wait)
        wait_flag=0; shift
        ;;
      *)
        die "unknown ocr flag: $1"
        ;;
    esac
  done
  [ -n "$model" ] || die "--model is required (e.g. --model llava:13b or --model mistral-ocr-latest)"

  # Refuse files larger than 32 MiB raw — base64 inflates ~33% on top, so a
  # 32 MiB PDF becomes a ~43 MiB shell variable and curl arg. Above this the
  # OS ARG_MAX often bites before the API does.
  local file_size_bytes
  file_size_bytes="$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)"
  if [ "$file_size_bytes" -gt 33554432 ]; then
    die "file is too large for the CLI uploader ($((file_size_bytes / 1024 / 1024)) MiB > 32 MiB). Use the web UI for big files."
  fi

  local mime
  case "${file##*.}" in
    pdf|PDF) mime="application/pdf" ;;
    png|PNG) mime="image/png" ;;
    jpg|jpeg|JPG|JPEG) mime="image/jpeg" ;;
    webp|WEBP) mime="image/webp" ;;
    *) die "unsupported file type: ${file##*.}" ;;
  esac

  local b64
  if base64 --help 2>&1 | grep -q -- "-w"; then
    b64="$(base64 -w 0 < "$file")"
  else
    b64="$(base64 < "$file" | tr -d '\n')"
  fi
  local data_url="data:${mime};base64,${b64}"
  local file_basename
  file_basename="$(basename "$file")"

  # Build the request body via python3 — passes user input on stdin only,
  # so filenames/data URLs cannot escape into shell or python source.
  local body
  body="$(python3 -c '
import json, sys
file_name, model, preview = sys.stdin.read().split("\x1f", 2)
print(json.dumps({
  "files": [
    {"fileName": file_name, "model": model, "preview": preview}
  ]
}, separators=(",", ":")))
' <<<"${file_basename}"$'\x1f'"${model}"$'\x1f'"${data_url}")"

  info "submitting OCR for ${file_basename}..."
  local response
  response="$(api_post_json "/api/v1/ocr/batch" "$body")"

  if [ -n "$out" ]; then
    printf "%s" "$response" > "$out"
    ok "saved response to ${out}"
  else
    printf "%s\n" "$response"
  fi

  if [ $wait_flag -eq 1 ]; then
    local job_id
    job_id="$(printf "%s" "$response" | grep -oE '"jobId":"[^"]+"' | head -1 | cut -d'"' -f4)"
    if [ -n "$job_id" ]; then
      info "waiting for job ${job_id}..."
      cmd_jobs wait "$job_id"
    else
      warn "no jobId in response — the submission may have failed. Inspect the JSON above."
    fi
  fi
}

cmd_kb() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    export)
      local job_id="${1:-}"
      [ -n "$job_id" ] || die "usage: extracto kb export <job-id> --collection NAME --store-url URL --embed-model MODEL [--strategy fixed|sentence|paragraph] [--chunk-size N] [--overlap N]"
      shift
      local collection="" store_url="" store_kind="chroma" store_key="" \
            embed_model="" embed_provider="ollama" embed_endpoint="http://127.0.0.1:11434" embed_key="" \
            strategy="paragraph" chunk_size=512 overlap=64 min_chunk_size=0
      while [ $# -gt 0 ]; do
        case "$1" in
          --collection)     collection="${2:-}"; shift 2 ;;
          --store)          store_kind="${2:-}"; shift 2 ;;
          --store-url)      store_url="${2:-}"; shift 2 ;;
          --store-key)      store_key="${2:-}"; shift 2 ;;
          --embed-model)    embed_model="${2:-}"; shift 2 ;;
          --embed-provider) embed_provider="${2:-}"; shift 2 ;;
          --embed-endpoint) embed_endpoint="${2:-}"; shift 2 ;;
          --embed-key)      embed_key="${2:-}"; shift 2 ;;
          --strategy)       strategy="${2:-}"; shift 2 ;;
          --chunk-size)     chunk_size="${2:-}"; shift 2 ;;
          --overlap)        overlap="${2:-}"; shift 2 ;;
          --min-chunk-size) min_chunk_size="${2:-}"; shift 2 ;;
          *) die "unknown kb export flag: $1" ;;
        esac
      done
      [ -n "$collection" ]   || die "--collection is required"
      [ -n "$store_url" ]    || die "--store-url is required"
      [ -n "$embed_model" ]  || die "--embed-model is required"

      local body
      body="$(python3 -c '
import json, sys
parts = sys.stdin.read().split("\x1f")
(job_id, collection, store_kind, store_url, store_key,
 embed_provider, embed_endpoint, embed_key, embed_model,
 strategy, chunk_size, overlap, min_chunk_size) = parts

payload = {
  "jobId": job_id,
  "collectionName": collection,
  "vectorStore": {"kind": store_kind, "baseUrl": store_url},
  "embedding": {
    "provider": embed_provider,
    "apiEndpoint": embed_endpoint,
    "model": embed_model,
  },
  "chunking": {"strategy": strategy, "maxChunkSize": int(chunk_size)},
}
if store_key:
  payload["vectorStore"]["apiKey"] = store_key
if embed_key:
  payload["embedding"]["apiKey"] = embed_key
if int(overlap) > 0:
  payload["chunking"]["overlap"] = int(overlap)
if int(min_chunk_size) > 0:
  payload["chunking"]["minChunkSize"] = int(min_chunk_size)

print(json.dumps(payload, separators=(",", ":")))
' <<<"${job_id}"$'\x1f'"${collection}"$'\x1f'"${store_kind}"$'\x1f'"${store_url}"$'\x1f'"${store_key}"$'\x1f'"${embed_provider}"$'\x1f'"${embed_endpoint}"$'\x1f'"${embed_key}"$'\x1f'"${embed_model}"$'\x1f'"${strategy}"$'\x1f'"${chunk_size}"$'\x1f'"${overlap}"$'\x1f'"${min_chunk_size}")"

      info "exporting job ${job_id} to ${store_kind}://${store_url}/${collection}..."
      api_post_json "/api/v1/export/kb" "$body"
      ;;
    *)
      die "usage: extracto kb export <job-id> [flags]"
      ;;
  esac
}

cmd_uninstall() {
  ensure_project
  run_step "Removing Extracto containers and volumes..." compose down -v --remove-orphans
  run_step "Removing shell alias blocks..." remove_extracto_block "${HOME}/.bashrc"
  run_step "Removing shell alias blocks..." remove_extracto_block "${HOME}/.zshrc"

  if [ -L "$USER_BIN" ]; then
    run_step "Removing extracto command..." rm -f "$USER_BIN"
  fi
  if [ -f "$RUNTIME_ENV_FILE" ]; then
    run_step "Removing local runtime env..." rm -f "$RUNTIME_ENV_FILE"
  fi

  ok "Extracto has been uninstalled"
  info "Ollama was kept installed as requested"
}

print_help() {
  cat <<EOF
Usage: extracto <command> [args...]

Lifecycle:
  on                            Start Extracto (animated status)
  off                           Stop Extracto (animated status)
  status                        Show running container state
  logs                          Tail app logs (docker compose logs -f app)
  uninstall                     Remove Extracto command and app resources (keeps Ollama)

API keys (require running container):
  api-key create <email> <name> Create an API key for a user
  api-key list <email>          List API keys for a user
  api-key revoke <key-id>       Revoke an API key by id

Headless API (requires EXTRACTO_TOKEN env or ~/.extracto/config):
  ocr <file> [--model N] [--out P] [--no-wait]
                                Submit a file for OCR (pdf/png/jpg/webp)
  jobs list [limit]             List recent OCR jobs (default 20)
  jobs get <id>                 Show one job
  jobs delete <id>              Delete a job
  jobs cancel <id>              Request a job stop
  jobs wait <id>                Poll until the job leaves QUEUED/RUNNING
  presets list                  List output presets
  presets create <name> <inst> [markdown|json]
  presets delete <id>
  settings get                  Show current API provider settings
  kb export <job-id> --collection N --store-url URL --embed-model M
                                Export an OCR job's text to a vector store
                                (requires KB_EXPORT_ENABLED=1 on the server)

Environment:
  EXTRACTO_URL                  Base URL (default http://127.0.0.1:3000)
  EXTRACTO_TOKEN                Bearer token for /api/v1/* requests

Logs:
  Internal command logs are saved to: ${LOG_DIR}
EOF
}

main() {
  local command="${1:-}"
  case "$command" in
    on)        cmd_on ;;
    off)       cmd_off ;;
    status)    cmd_status ;;
    logs)      cmd_logs ;;
    api-key)   shift; cmd_api_key "$@" ;;
    uninstall) cmd_uninstall ;;
    ocr)       shift; cmd_ocr "$@" ;;
    jobs)      shift; cmd_jobs "$@" ;;
    presets)   shift; cmd_presets "$@" ;;
    settings)  shift; cmd_settings "$@" ;;
    kb)        shift; cmd_kb "$@" ;;
    -h|--help|help|"")
      print_help
      ;;
    *)
      die "unknown command '${command}'. Run 'extracto --help'."
      ;;
  esac
}

main "$@"
