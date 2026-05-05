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

append_runtime_env_var() {
  local key="$1"
  local value="$2"
  mkdir -p "$(dirname "$RUNTIME_ENV_FILE")"
  umask 077
  [ -f "$RUNTIME_ENV_FILE" ] || : > "$RUNTIME_ENV_FILE"
  chmod 600 "$RUNTIME_ENV_FILE" 2>/dev/null || true
  printf "%s=%s\n" "$key" "$value" >> "$RUNTIME_ENV_FILE"
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
  append_runtime_env_var "AUTH_SECRET" "$generated"
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

cleanup_stale_containers() {
  command -v docker >/dev/null 2>&1 || return 0
  local stale
  stale="$(docker ps -a \
    --filter 'name=^extracto$' \
    --filter 'label=com.docker.compose.project' \
    --format '{{.ID}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null || true)"
  local plain
  plain="$(docker ps -a --filter 'name=^extracto$' --format '{{.ID}}' 2>/dev/null || true)"
  local id
  for id in $plain; do
    local proj
    proj="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$id" 2>/dev/null || true)"
    if [ -z "$proj" ] || [ "$proj" = "<no value>" ]; then
      warn "Removing stale container 'extracto' (created by 'docker run', conflicts with compose stack)"
      docker rm -f "$id" >/dev/null 2>&1 || true
    fi
  done
}

cmd_on() {
  ensure_project
  ensure_auth_secret
  cleanup_stale_containers
  local build_locally=0
  for arg in "$@"; do
    case "$arg" in
      --build) build_locally=1 ;;
      *) die "unknown flag: $arg (did you mean --build?)" ;;
    esac
  done
  if [ "$build_locally" = "1" ]; then
    run_step "Building Extracto from source..." compose build
    run_step "Turning up Extracto..." compose up -d
  else
    run_step "Pulling Extracto image from ghcr.io..." compose pull
    run_step "Turning up Extracto..." compose up -d
  fi
  run_step "Checking Extracto health..." compose ps
  ok "Extracto is running at http://localhost:3000"
}

cmd_off() {
  ensure_project
  run_step "Shutting down Extracto..." compose down
  ok "Extracto is shut down"
}

cmd_upgrade() {
  ensure_project
  cleanup_stale_containers
  run_step "Pulling latest Extracto image from ghcr.io..." compose pull
  run_step "Recreating Extracto container..." compose up -d --force-recreate
  run_step "Checking Extracto health..." compose ps
  ok "Extracto upgraded and running at http://localhost:3000"
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

write_curl_config() {
  local config_file="$1"
  shift
  : > "$config_file"
  chmod 600 "$config_file" 2>/dev/null || true

  local header escaped
  for header in "$@"; do
    case "$header" in
      *$'\n'*|*$'\r'*) die "invalid curl header" ;;
    esac
    escaped="${header//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    printf 'header = "%s"\n' "$escaped" >> "$config_file"
  done
}

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
  case "$tok" in
    *$'\n'*|*$'\r'*) die "API token must not contain newlines" ;;
  esac
  printf "%s" "$tok"
}

api_get() {
  # api_get <path> [query]
  local path="$1"
  local token
  token="$(require_token)"
  local config_file rc
  config_file="$(mktemp)"
  write_curl_config "$config_file" "Authorization: Bearer ${token}" "Accept: application/json"
  if curl -fsS --config "$config_file" "${EXTRACTO_URL_DEFAULT}${path}"; then
    rc=0
  else
    rc=$?
  fi
  rm -f "$config_file"
  return "$rc"
}

api_get_raw() {
  # api_get_raw <path> <out-file>
  local path="$1"
  local out="$2"
  local token
  token="$(require_token)"
  local config_file rc
  config_file="$(mktemp)"
  write_curl_config "$config_file" "Authorization: Bearer ${token}"
  if curl -fsS --config "$config_file" -o "$out" "${EXTRACTO_URL_DEFAULT}${path}"; then
    rc=0
  else
    rc=$?
  fi
  rm -f "$config_file"
  return "$rc"
}

api_post_json() {
  # api_post_json <path> <json-body>
  local path="$1"
  local body="$2"
  local token
  token="$(require_token)"
  local config_file rc
  config_file="$(mktemp)"
  write_curl_config "$config_file" "Authorization: Bearer ${token}" "Content-Type: application/json" "Accept: application/json"
  if printf "%s" "$body" | curl -fsS -X POST --config "$config_file" --data-binary @- "${EXTRACTO_URL_DEFAULT}${path}"; then
    rc=0
  else
    rc=$?
  fi
  rm -f "$config_file"
  return "$rc"
}

api_delete() {
  local path="$1"
  local token
  token="$(require_token)"
  local config_file rc
  config_file="$(mktemp)"
  write_curl_config "$config_file" "Authorization: Bearer ${token}"
  if curl -fsS -X DELETE --config "$config_file" "${EXTRACTO_URL_DEFAULT}${path}"; then
    rc=0
  else
    rc=$?
  fi
  rm -f "$config_file"
  return "$rc"
}

api_put_json() {
  # api_put_json <path> <json-body>
  local path="$1"
  local body="$2"
  local token
  token="$(require_token)"
  local config_file rc
  config_file="$(mktemp)"
  write_curl_config "$config_file" "Authorization: Bearer ${token}" "Content-Type: application/json" "Accept: application/json"
  if printf "%s" "$body" | curl -fsS -X PUT --config "$config_file" --data-binary @- "${EXTRACTO_URL_DEFAULT}${path}"; then
    rc=0
  else
    rc=$?
  fi
  rm -f "$config_file"
  return "$rc"
}

api_patch_json() {
  # api_patch_json <path> <json-body>
  local path="$1"
  local body="$2"
  local token
  token="$(require_token)"
  local config_file rc
  config_file="$(mktemp)"
  write_curl_config "$config_file" "Authorization: Bearer ${token}" "Content-Type: application/json" "Accept: application/json"
  if printf "%s" "$body" | curl -fsS -X PATCH --config "$config_file" --data-binary @- "${EXTRACTO_URL_DEFAULT}${path}"; then
    rc=0
  else
    rc=$?
  fi
  rm -f "$config_file"
  return "$rc"
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

cmd_dropbox() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    list)
      local path="${1:-}"
      api_get "/api/v1/integrations/dropbox/list?path=$(printf %s "$path" | python3 -c 'import sys,urllib.parse; sys.stdout.write(urllib.parse.quote(sys.stdin.read()))')"
      ;;
    import)
      local dx_path="" dx_model=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --path)  dx_path="${2:-}"; shift 2 ;;
          --model) dx_model="${2:-}"; shift 2 ;;
          *) die "unknown dropbox import flag: $1" ;;
        esac
      done
      [ -n "$dx_path" ] || die "usage: extracto dropbox import --path /folder/file.pdf --model NAME"
      [ -n "$dx_model" ] || die "--model is required"
      local body
      body="$(EXTRACTO_DX_PATH="$dx_path" EXTRACTO_DX_MODEL="$dx_model" python3 -c '
import json, os
print(json.dumps({"path": os.environ["EXTRACTO_DX_PATH"], "model": os.environ["EXTRACTO_DX_MODEL"]}))
')"
      api_post_json "/api/v1/integrations/dropbox/import" "$body"
      ;;
    push)
      local dx_job="" dx_folder="" dx_format="md"
      while [ $# -gt 0 ]; do
        case "$1" in
          --job)    dx_job="${2:-}"; shift 2 ;;
          --folder) dx_folder="${2:-}"; shift 2 ;;
          --format) dx_format="${2:-}"; shift 2 ;;
          *) die "unknown dropbox push flag: $1" ;;
        esac
      done
      [ -n "$dx_job" ] || die "usage: extracto dropbox push --job <job-id> [--folder /path] [--format md|...|obsidian]"
      case "$dx_format" in
        md|json|txt|html|docx|rtf|csv|xlsx|obsidian) ;;
        *) die "--format must be one of: md, json, txt, html, docx, rtf, csv, xlsx, obsidian" ;;
      esac
      local body
      body="$(EXTRACTO_DX_JOB="$dx_job" EXTRACTO_DX_FOLDER="$dx_folder" EXTRACTO_DX_FORMAT="$dx_format" python3 -c '
import json, os
print(json.dumps({
  "jobId": os.environ["EXTRACTO_DX_JOB"],
  "folder": os.environ.get("EXTRACTO_DX_FOLDER",""),
  "format": os.environ["EXTRACTO_DX_FORMAT"],
}))
')"
      api_post_json "/api/v1/integrations/dropbox/push" "$body"
      ;;
    disconnect)
      api_delete "/api/v1/integrations/dropbox"
      ;;
    *)
      die "usage: extracto dropbox {list [path]|import --path P --model M|push --job ID [--folder F] [--format X]|disconnect}"
      ;;
  esac
}

cmd_gdrive() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    list)
      local folder_id="${1:-root}"
      api_get "/api/v1/integrations/google_drive/list?folderId=$(printf %s "$folder_id" | python3 -c 'import sys,urllib.parse; sys.stdout.write(urllib.parse.quote(sys.stdin.read()))')"
      ;;
    import)
      local gd_file="" gd_model=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --file)  gd_file="${2:-}"; shift 2 ;;
          --model) gd_model="${2:-}"; shift 2 ;;
          *) die "unknown gdrive import flag: $1" ;;
        esac
      done
      [ -n "$gd_file" ] || die "usage: extracto gdrive import --file <google-file-id> --model NAME"
      [ -n "$gd_model" ] || die "--model is required"
      local body
      body="$(EXTRACTO_GD_FILE="$gd_file" EXTRACTO_GD_MODEL="$gd_model" python3 -c '
import json, os
print(json.dumps({"fileId": os.environ["EXTRACTO_GD_FILE"], "model": os.environ["EXTRACTO_GD_MODEL"]}))
')"
      api_post_json "/api/v1/integrations/google_drive/import" "$body"
      ;;
    push)
      local gd_job="" gd_parent="" gd_format="md"
      while [ $# -gt 0 ]; do
        case "$1" in
          --job)    gd_job="${2:-}"; shift 2 ;;
          --parent) gd_parent="${2:-}"; shift 2 ;;
          --format) gd_format="${2:-}"; shift 2 ;;
          *) die "unknown gdrive push flag: $1" ;;
        esac
      done
      [ -n "$gd_job" ] || die "usage: extracto gdrive push --job <job-id> [--parent <folder-id>] [--format md|...|obsidian]"
      case "$gd_format" in
        md|json|txt|html|docx|rtf|csv|xlsx|obsidian) ;;
        *) die "--format must be one of: md, json, txt, html, docx, rtf, csv, xlsx, obsidian" ;;
      esac
      local body
      body="$(EXTRACTO_GD_JOB="$gd_job" EXTRACTO_GD_PARENT="$gd_parent" EXTRACTO_GD_FORMAT="$gd_format" python3 -c '
import json, os
print(json.dumps({
  "jobId": os.environ["EXTRACTO_GD_JOB"],
  "parentId": os.environ.get("EXTRACTO_GD_PARENT",""),
  "format": os.environ["EXTRACTO_GD_FORMAT"],
}))
')"
      api_post_json "/api/v1/integrations/google_drive/push" "$body"
      ;;
    disconnect)
      api_delete "/api/v1/integrations/google_drive"
      ;;
    *)
      die "usage: extracto gdrive {list [folder-id]|import --file ID --model M|push --job ID [--parent ID] [--format X]|disconnect}"
      ;;
  esac
}

cmd_onedrive() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    list)
      local folder_id="${1:-}"
      api_get "/api/v1/integrations/onedrive/list?folderId=$(printf %s "$folder_id" | python3 -c 'import sys,urllib.parse; sys.stdout.write(urllib.parse.quote(sys.stdin.read()))')"
      ;;
    import)
      local od_file="" od_model=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --file)  od_file="${2:-}"; shift 2 ;;
          --model) od_model="${2:-}"; shift 2 ;;
          *) die "unknown onedrive import flag: $1" ;;
        esac
      done
      [ -n "$od_file" ] || die "usage: extracto onedrive import --file <onedrive-item-id> --model NAME"
      [ -n "$od_model" ] || die "--model is required"
      local body
      body="$(EXTRACTO_OD_FILE="$od_file" EXTRACTO_OD_MODEL="$od_model" python3 -c '
import json, os
print(json.dumps({"fileId": os.environ["EXTRACTO_OD_FILE"], "model": os.environ["EXTRACTO_OD_MODEL"]}))
')"
      api_post_json "/api/v1/integrations/onedrive/import" "$body"
      ;;
    push)
      local od_job="" od_parent="" od_format="md"
      while [ $# -gt 0 ]; do
        case "$1" in
          --job)    od_job="${2:-}"; shift 2 ;;
          --parent) od_parent="${2:-}"; shift 2 ;;
          --format) od_format="${2:-}"; shift 2 ;;
          *) die "unknown onedrive push flag: $1" ;;
        esac
      done
      [ -n "$od_job" ] || die "usage: extracto onedrive push --job <job-id> [--parent <item-id>] [--format md|...|obsidian]"
      case "$od_format" in
        md|json|txt|html|docx|rtf|csv|xlsx|obsidian) ;;
        *) die "--format must be one of: md, json, txt, html, docx, rtf, csv, xlsx, obsidian" ;;
      esac
      local body
      body="$(EXTRACTO_OD_JOB="$od_job" EXTRACTO_OD_PARENT="$od_parent" EXTRACTO_OD_FORMAT="$od_format" python3 -c '
import json, os
print(json.dumps({
  "jobId": os.environ["EXTRACTO_OD_JOB"],
  "parentId": os.environ.get("EXTRACTO_OD_PARENT",""),
  "format": os.environ["EXTRACTO_OD_FORMAT"],
}))
')"
      api_post_json "/api/v1/integrations/onedrive/push" "$body"
      ;;
    disconnect)
      api_delete "/api/v1/integrations/onedrive"
      ;;
    *)
      die "usage: extracto onedrive {list [folder-id]|import --file ID --model M|push --job ID [--parent ID] [--format X]|disconnect}"
      ;;
  esac
}

cmd_estimate() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required by 'extracto estimate' for safe JSON construction"
  local file="" pages="" model="" provider="" endpoint="" pp_model="" pp_format="" out_tokens="" in_tokens=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --pages)            pages="${2:-}"; shift 2 ;;
      --model)            model="${2:-}"; shift 2 ;;
      --provider)         provider="${2:-}"; shift 2 ;;
      --api-endpoint)     endpoint="${2:-}"; shift 2 ;;
      --post-model)       pp_model="${2:-}"; shift 2 ;;
      --post-format)      pp_format="${2:-}"; shift 2 ;;
      --output-tokens)    out_tokens="${2:-}"; shift 2 ;;
      --input-tokens)     in_tokens="${2:-}"; shift 2 ;;
      -h|--help)
        cat <<EOF
usage:
  extracto estimate <file> --model NAME [--provider P] [--api-endpoint URL] [--post-model NAME] [--post-format markdown|json] [--output-tokens N] [--input-tokens N]
  extracto estimate --pages N --model NAME [...]

Returns dollar cost for OCR'ing the supplied file (page count auto-detected
for PDFs via pdfinfo; images count as 1 page) or a flat --pages count.
Pricing source is shown per provider. Self-hosted endpoints with no mirror
entry return \$0 plus a warning.
EOF
        return 0
        ;;
      *)
        if [ -z "$file" ] && [ -z "$pages" ] && [ -f "$1" ]; then
          file="$1"; shift
        else
          die "unknown estimate flag or argument: $1"
        fi
        ;;
    esac
  done

  [ -n "$model" ] || die "--model is required (e.g. --model mistral-ocr-latest)"
  if [ -z "$pages" ] && [ -z "$file" ]; then
    die "supply either a file path or --pages N"
  fi

  if [ -n "$file" ]; then
    [ -f "$file" ] || die "file not found: $file"
    case "${file##*.}" in
      pdf|PDF)
        command -v pdfinfo >/dev/null 2>&1 || die "pdfinfo (poppler-utils) required for PDF page count. Install poppler-utils, or pass --pages N to override."
        pages="$(pdfinfo "$file" 2>/dev/null | awk '/^Pages:/ {print $2}')"
        [ -n "$pages" ] || die "could not read page count from PDF"
        ;;
      png|PNG|jpg|jpeg|JPG|JPEG|webp|WEBP)
        pages="${pages:-1}"
        ;;
      *)
        die "unsupported file type: ${file##*.}"
        ;;
    esac
  fi
  case "$pages" in ''|*[!0-9]*) die "--pages must be a positive integer (got '${pages}')" ;; esac
  [ "$pages" -ge 1 ] || die "--pages must be >= 1"

  if [ -n "$provider" ]; then
    case "$provider" in
      ollama|mistral|openrouter|openai_compat) ;;
      *) die "--provider must be one of: ollama, mistral, openrouter, openai_compat" ;;
    esac
  fi

  if [ -n "$pp_format" ]; then
    case "$pp_format" in
      markdown|json) ;;
      *) die "--post-format must be 'markdown' or 'json'" ;;
    esac
  fi

  if [ -n "$out_tokens" ]; then
    case "$out_tokens" in ''|*[!0-9]*) die "--output-tokens must be a non-negative integer" ;; esac
  fi
  if [ -n "$in_tokens" ]; then
    case "$in_tokens" in ''|*[!0-9]*) die "--input-tokens must be a non-negative integer" ;; esac
  fi

  local file_basename=""
  if [ -n "$file" ]; then
    file_basename="$(basename "$file")"
  fi

  local body
  body="$(EXTRACTO_PAGES="$pages" EXTRACTO_MODEL="$model" EXTRACTO_PROVIDER="$provider" \
       EXTRACTO_ENDPOINT="$endpoint" EXTRACTO_FILE="$file_basename" EXTRACTO_PP_MODEL="$pp_model" \
       EXTRACTO_PP_FORMAT="$pp_format" EXTRACTO_OUT="$out_tokens" EXTRACTO_IN="$in_tokens" \
       python3 -c '
import json, os
file_entry = {"pageCount": int(os.environ["EXTRACTO_PAGES"])}
if os.environ.get("EXTRACTO_FILE"):
    file_entry["fileName"] = os.environ["EXTRACTO_FILE"]
out = {"files": [file_entry], "model": os.environ["EXTRACTO_MODEL"]}
if os.environ.get("EXTRACTO_PROVIDER"):
    out["provider"] = os.environ["EXTRACTO_PROVIDER"]
if os.environ.get("EXTRACTO_ENDPOINT"):
    out["apiEndpoint"] = os.environ["EXTRACTO_ENDPOINT"]
if os.environ.get("EXTRACTO_PP_MODEL"):
    pp = {"enabled": True, "model": os.environ["EXTRACTO_PP_MODEL"]}
    if os.environ.get("EXTRACTO_PP_FORMAT"):
        pp["outputFormat"] = os.environ["EXTRACTO_PP_FORMAT"]
    out["postProcessing"] = pp
if os.environ.get("EXTRACTO_OUT"):
    out["outputTokensPerPage"] = int(os.environ["EXTRACTO_OUT"])
if os.environ.get("EXTRACTO_IN"):
    out["inputTokensPerPage"] = int(os.environ["EXTRACTO_IN"])
print(json.dumps(out))
')"

  api_post_json "/api/v1/ocr/estimate" "$body"
}

cmd_redact() {
  command -v python3 >/dev/null 2>&1 || die "python3 is required by 'extracto redact'"
  local file="" text=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --file) file="${2:-}"; shift 2 ;;
      --text) text="${2:-}"; shift 2 ;;
      *) die "unknown redact flag: $1" ;;
    esac
  done
  if [ -n "$file" ]; then
    [ -f "$file" ] || die "file not found: $file"
    text="$(cat "$file")"
  fi
  [ -n "$text" ] || die "usage: extracto redact (--text \"...\" | --file PATH)"
  local body
  body="$(EXTRACTO_REDACT_TEXT="$text" python3 -c '
import json, os
print(json.dumps({"text": os.environ["EXTRACTO_REDACT_TEXT"]}))
')"
  api_post_json "/api/v1/pii/redact" "$body"
}

cmd_recommend() {
  local days=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --days) days="${2:-}"; shift 2 ;;
      *) die "unknown recommend flag: $1" ;;
    esac
  done
  if [ -n "$days" ]; then
    case "$days" in ''|*[!0-9]*) die "--days must be a positive integer" ;; esac
    api_get "/api/v1/recommendations?days=${days}"
  else
    api_get "/api/v1/recommendations"
  fi
}

cmd_compare() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    get)
      [ -n "${1:-}" ] || die "usage: extracto compare get <comparison-id>"
      local enc
      if command -v python3 >/dev/null 2>&1; then
        enc="$(printf %s "$1" | python3 -c 'import sys,urllib.parse; sys.stdout.write(urllib.parse.quote(sys.stdin.read()))')"
      else
        enc="$1"
      fi
      api_get "/api/v1/ocr/compare?id=${enc}"
      ;;
    run|"")
      command -v python3 >/dev/null 2>&1 || die "python3 is required by 'extracto compare run'"
      local file="" models=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --file)   file="${2:-}"; shift 2 ;;
          --models) models="${2:-}"; shift 2 ;;
          *) die "unknown compare flag: $1" ;;
        esac
      done
      [ -n "$file" ] || die "usage: extracto compare run --file PATH --models a,b[,c[,d]]"
      [ -n "$models" ] || die "--models is required (comma-separated, 2-4 model ids)"
      [ -f "$file" ] || die "file not found: $file"
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
      local file_basename
      file_basename="$(basename "$file")"
      local body
      body="$(EXTRACTO_CMP_NAME="$file_basename" EXTRACTO_CMP_PREVIEW="data:${mime};base64,${b64}" EXTRACTO_CMP_MODELS="$models" python3 -c '
import json, os
print(json.dumps({
  "fileName": os.environ["EXTRACTO_CMP_NAME"],
  "preview": os.environ["EXTRACTO_CMP_PREVIEW"],
  "models": [m for m in os.environ["EXTRACTO_CMP_MODELS"].split(",") if m.strip()],
}))
')"
      api_post_json "/api/v1/ocr/compare" "$body"
      ;;
    *)
      die "usage: extracto compare {run --file PATH --models a,b[,c[,d]]|get <comparison-id>}"
      ;;
  esac
}

cmd_jobs() {
  local sub="${1:-list}"
  shift || true
  case "$sub" in
    list)
      local limit="20"
      local qs=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --status) qs="${qs}&status=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')"; shift 2 ;;
          --q) qs="${qs}&q=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')"; shift 2 ;;
          --model) qs="${qs}&model=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')"; shift 2 ;;
          --from) qs="${qs}&from=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')"; shift 2 ;;
          --to) qs="${qs}&to=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')"; shift 2 ;;
          --tags) qs="${qs}&tagIds=$(printf '%s' "$2" | python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.stdin.read()))')"; shift 2 ;;
          --) shift; break ;;
          -*) die "unknown flag: $1" ;;
          *) limit="$1"; shift ;;
        esac
      done
      api_get "/api/jobs?limit=${limit}${qs}"
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
    export)
      [ -n "${1:-}" ] || die "usage: extracto jobs export <job-id> [--format md|json|txt|html|docx|rtf|csv|xlsx|obsidian] [--out PATH]"
      local ex_job_id="$1"; shift
      local ex_format="md" ex_out=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --format) ex_format="${2:-}"; shift 2 ;;
          --out)    ex_out="${2:-}"; shift 2 ;;
          *) die "unknown export flag: $1" ;;
        esac
      done
      case "$ex_format" in
        md|json|txt|html|docx|rtf|csv|xlsx|obsidian) ;;
        *) die "--format must be one of: md, json, txt, html, docx, rtf, csv, xlsx, obsidian" ;;
      esac
      if [ -z "$ex_out" ]; then
        if [ "$ex_format" = "obsidian" ]; then
          ex_out="${ex_job_id}-vault.zip"
        else
          ex_out="${ex_job_id}.${ex_format}"
        fi
      fi
      api_get_raw "/api/v1/jobs/${ex_job_id}/export?format=${ex_format}" "$ex_out" \
        || die "export failed (job=${ex_job_id} format=${ex_format})"
      ok "wrote ${ex_out}"
      ;;
    form-fields)
      [ -n "${1:-}" ] || die "usage: extracto jobs form-fields <job-id>"
      api_get "/api/v1/jobs/${1}/form-fields"
      ;;
    equations)
      [ -n "${1:-}" ] || die "usage: extracto jobs equations <job-id>"
      api_get "/api/v1/jobs/${1}/equations"
      ;;
    edit-page)
      [ -n "${1:-}" ] && [ -n "${2:-}" ] || die "usage: extracto jobs edit-page <job-id> <page-number> (--text TEXT | --from-file PATH)"
      local ep_job_id="$1"
      local ep_page="$2"
      shift 2
      local ep_text=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --text) ep_text="${2:-}"; shift 2 ;;
          --from-file)
            [ -f "${2:-}" ] || die "file not found: ${2:-}"
            ep_text="$(cat "$2")"; shift 2 ;;
          *) die "unknown flag: $1" ;;
        esac
      done
      [ -n "$ep_text" ] || die "--text or --from-file is required"
      api_patch_json "/api/v1/jobs/${ep_job_id}/pages/${ep_page}" \
        "$(printf '{"text":%s}' \
          "$(printf '%s' "$ep_text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
      ;;
    page-history)
      [ -n "${1:-}" ] && [ -n "${2:-}" ] || die "usage: extracto jobs page-history <job-id> <page-number>"
      api_get "/api/v1/jobs/${1}/pages/${2}"
      ;;
    bulk-tag)
      local mode="add"
      local job_csv=""
      local tag_csv=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --mode) mode="${2:-add}"; shift 2 ;;
          --jobs) job_csv="${2:-}"; shift 2 ;;
          --tags) tag_csv="${2:-}"; shift 2 ;;
          *) die "usage: extracto jobs bulk-tag --jobs id,id,... --tags id,id,... [--mode add|replace]" ;;
        esac
      done
      [ -n "$job_csv" ] || die "--jobs is required"
      local job_json tag_json
      job_json="$(printf '%s' "$job_csv" | python3 -c 'import json,sys; print(json.dumps([s for s in sys.stdin.read().split(",") if s]))')"
      tag_json="$(printf '%s' "$tag_csv" | python3 -c 'import json,sys; print(json.dumps([s for s in sys.stdin.read().split(",") if s]))')"
      api_post_json "/api/v1/jobs/bulk/tags" \
        "$(printf '{"jobIds":%s,"tagIds":%s,"mode":%s}' "$job_json" "$tag_json" \
          "$(printf '%s' "$mode" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
      ;;
    set-tags)
      [ -n "${1:-}" ] || die "usage: extracto jobs set-tags <job-id> [<tag-id> ...]"
      local job_id="$1"
      shift
      local ids_json="["
      local first=1
      for tag_id in "$@"; do
        if [ "$first" -eq 1 ]; then first=0; else ids_json="${ids_json},"; fi
        ids_json="${ids_json}$(printf '%s' "$tag_id" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
      done
      ids_json="${ids_json}]"
      api_put_json "/api/v1/jobs/${job_id}/tags" "$(printf '{"tagIds":%s}' "$ids_json")"
      ;;
    *)
      die "usage: extracto jobs <list|get|export|form-fields|equations|delete|cancel|wait|set-tags|bulk-tag|edit-page|page-history> [args...]"
      ;;
  esac
}

cmd_tags() {
  local sub="${1:-list}"
  shift || true
  case "$sub" in
    list)
      api_get "/api/v1/tags"
      ;;
    create)
      local name="${1:-}"
      local color="${2:-slate}"
      [ -n "$name" ] || die "usage: extracto tags create <name> [color]"
      api_post_json "/api/v1/tags" \
        "$(printf '{"name":%s,"color":%s}' \
          "$(printf '%s' "$name" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
          "$(printf '%s' "$color" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
      ;;
    update)
      local id="${1:-}"
      [ -n "$id" ] || die "usage: extracto tags update <id> [--name X] [--color C]"
      shift
      local name=""
      local color=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --name) name="${2:-}"; shift 2 ;;
          --color) color="${2:-}"; shift 2 ;;
          *) die "unknown flag: $1" ;;
        esac
      done
      local body="{"
      local first=1
      if [ -n "$name" ]; then
        body="${body}\"name\":$(printf '%s' "$name" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
        first=0
      fi
      if [ -n "$color" ]; then
        if [ "$first" -eq 0 ]; then body="${body},"; fi
        body="${body}\"color\":$(printf '%s' "$color" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
      fi
      body="${body}}"
      api_patch_json "/api/v1/tags/${id}" "$body"
      ;;
    delete)
      [ -n "${1:-}" ] || die "usage: extracto tags delete <id>"
      api_delete "/api/v1/tags/${1}"
      ;;
    *)
      die "usage: extracto tags <list|create|update|delete> [args...]"
      ;;
  esac
}

cmd_searches() {
  local sub="${1:-list}"
  shift || true
  case "$sub" in
    list)
      api_get "/api/v1/saved-searches"
      ;;
    save)
      local name="${1:-}"
      [ -n "$name" ] || die "usage: extracto searches save <name> [--q TEXT] [--status S] [--from DATE] [--to DATE] [--model TEXT] [--tags id,id]"
      shift
      local q="" status="" from="" to="" model="" tags=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --q) q="$2"; shift 2 ;;
          --status) status="$2"; shift 2 ;;
          --from) from="$2"; shift 2 ;;
          --to) to="$2"; shift 2 ;;
          --model) model="$2"; shift 2 ;;
          --tags) tags="$2"; shift 2 ;;
          *) die "unknown flag: $1" ;;
        esac
      done
      local filters
      filters="$(NAME="" Q="$q" STATUS="$status" FROM="$from" TO="$to" MODEL="$model" TAGS="$tags" python3 -c '
import json, os
out = {}
for k, v in (("q", os.environ.get("Q","")), ("status", os.environ.get("STATUS","")), ("from", os.environ.get("FROM","")), ("to", os.environ.get("TO","")), ("model", os.environ.get("MODEL",""))):
    if v: out[k] = v
tags = os.environ.get("TAGS","")
if tags:
    out["tagIds"] = [t for t in tags.split(",") if t]
print(json.dumps(out))
')"
      api_post_json "/api/v1/saved-searches" \
        "$(printf '{"name":%s,"filters":%s}' \
          "$(printf '%s' "$name" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
          "$filters")"
      ;;
    rename)
      [ -n "${1:-}" ] && [ -n "${2:-}" ] || die "usage: extracto searches rename <id> <new-name>"
      api_patch_json "/api/v1/saved-searches/${1}" \
        "$(printf '{"name":%s}' \
          "$(printf '%s' "$2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"
      ;;
    delete)
      [ -n "${1:-}" ] || die "usage: extracto searches delete <id>"
      api_delete "/api/v1/saved-searches/${1}"
      ;;
    *)
      die "usage: extracto searches <list|save|rename|delete> [args...]"
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
  [ -n "$file" ] || die "usage: extracto ocr <file> --model NAME [--out PATH] [--no-wait] [--pages 1-5,7] [--preset generic|academic|invoice|contract|form] [--no-text-layer] [--page-concurrency N] [--post-template translate|summarize-3sentence|summarize-executive|extract-actions|custom] [--target-language LANG] [--post-model NAME] [--post-format markdown|json]"
  [ -f "$file" ] || die "file not found: $file"
  local out="" model="" wait_flag=1 pages_spec="" preset="" prefer_text_layer="" page_concurrency="" pp_template="" pp_target_lang="" pp_model="" pp_format=""
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
      --pages)
        pages_spec="${2:-}"; shift 2
        ;;
      --preset)
        preset="${2:-}"
        case "$preset" in
          generic|academic|invoice|contract|form) ;;
          *) die "--preset must be one of: generic, academic, invoice, contract, form (got '${preset}')" ;;
        esac
        shift 2
        ;;
      --no-text-layer)
        prefer_text_layer="false"; shift
        ;;
      --text-layer)
        prefer_text_layer="true"; shift
        ;;
      --page-concurrency)
        page_concurrency="${2:-}"
        case "$page_concurrency" in
          ''|*[!0-9]*) die "--page-concurrency must be a positive integer (got '${page_concurrency}')" ;;
        esac
        if [ "$page_concurrency" -lt 1 ] || [ "$page_concurrency" -gt 16 ]; then
          die "--page-concurrency must be between 1 and 16"
        fi
        shift 2
        ;;
      --post-template)
        pp_template="${2:-}"
        case "$pp_template" in
          custom|translate|summarize-3sentence|summarize-executive|extract-actions) ;;
          *) die "--post-template must be one of: custom, translate, summarize-3sentence, summarize-executive, extract-actions" ;;
        esac
        shift 2
        ;;
      --target-language)
        pp_target_lang="${2:-}"; shift 2
        ;;
      --post-model)
        pp_model="${2:-}"; shift 2
        ;;
      --post-format)
        pp_format="${2:-}"
        case "$pp_format" in
          markdown|json) ;;
          *) die "--post-format must be 'markdown' or 'json'" ;;
        esac
        shift 2
        ;;
      *)
        die "unknown ocr flag: $1"
        ;;
    esac
  done
  [ -n "$model" ] || die "--model is required (e.g. --model llava:13b or --model mistral-ocr-latest)"

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

  local file_basename
  file_basename="$(basename "$file")"

  local pages_payload="" preview_payload=""
  if [ -n "$pages_spec" ]; then
    [ "$mime" = "application/pdf" ] || die "--pages only applies to PDF input"
    command -v pdftoppm >/dev/null 2>&1 || die "--pages requires 'pdftoppm' (poppler-utils). Install via your package manager (e.g. apt-get install poppler-utils, brew install poppler)."
    local extracto_tmpdir
    extracto_tmpdir="$(mktemp -d)"
    trap 'rm -rf "$extracto_tmpdir"' EXIT INT TERM
    local resolved_pages
    resolved_pages="$(python3 - "$pages_spec" <<'PY'
import sys
spec = sys.argv[1]
out, seen = [], set()
def fail(msg):
    sys.stderr.write(msg + "\n")
    sys.exit(2)
for raw in spec.split(","):
    part = raw.strip()
    if not part:
        continue
    if "-" in part:
        sides = part.split("-")
        if len(sides) != 2:
            fail(f"malformed range: '{raw}'")
        a, b = sides[0].strip(), sides[1].strip()
        if not a or not b:
            fail(f"malformed range: '{raw}' (missing endpoint)")
        try:
            a = int(a); b = int(b)
        except ValueError:
            fail(f"malformed range: '{raw}' (non-integer endpoint)")
        if a < 1 or b < 1:
            fail(f"page numbers must be >= 1 ('{raw}')")
        lo, hi = (a, b) if a <= b else (b, a)
        if hi - lo > 9999:
            fail(f"range too wide: '{raw}'")
        for n in range(lo, hi + 1):
            if n not in seen:
                seen.add(n); out.append(n)
    else:
        try:
            n = int(part)
        except ValueError:
            fail(f"not an integer: '{raw}'")
        if n < 1:
            fail(f"page numbers must be >= 1 ('{raw}')")
        if n not in seen:
            seen.add(n); out.append(n)
if not out:
    fail("no valid page numbers")
out.sort()
print(",".join(str(n) for n in out))
PY
)" || die "--pages parse error (see above)"
    local pages_b64_list="" page_numbers_list="" page_count=0
    local IFS_BAK="$IFS"
    IFS=','
    for page_num in $resolved_pages; do
      local stem="$extracto_tmpdir/page-$page_num"
      pdftoppm -singlefile -f "$page_num" -l "$page_num" -jpeg -r 150 "$file" "$stem" >/dev/null 2>&1 \
        || die "pdftoppm failed on page $page_num"
      local rendered="${stem}.jpg"
      [ -f "$rendered" ] || die "no rendered output for page $page_num at $rendered"
      local pb64
      if base64 --help 2>&1 | grep -q -- "-w"; then
        pb64="$(base64 -w 0 < "$rendered")"
      else
        pb64="$(base64 < "$rendered" | tr -d '\n')"
      fi
      rm -f "$rendered"
      local page_durl="data:image/jpeg;base64,${pb64}"
      if [ -z "$pages_b64_list" ]; then
        pages_b64_list="$page_durl"
        page_numbers_list="$page_num"
      else
        pages_b64_list="${pages_b64_list}"$'\x1e'"$page_durl"
        page_numbers_list="${page_numbers_list},${page_num}"
      fi
      page_count=$((page_count + 1))
    done
    IFS="$IFS_BAK"
    pages_payload="$pages_b64_list"
    preview_payload="${pages_b64_list%%$'\x1e'*}"
    info "extracted ${page_count} page(s) via pdftoppm: pages=${page_numbers_list}"
  else
    local b64
    if base64 --help 2>&1 | grep -q -- "-w"; then
      b64="$(base64 -w 0 < "$file")"
    else
      b64="$(base64 < "$file" | tr -d '\n')"
    fi
    preview_payload="data:${mime};base64,${b64}"
  fi

  local source_pdf=""
  if [ "$mime" = "application/pdf" ]; then
    local src_b64
    if base64 --help 2>&1 | grep -q -- "-w"; then
      src_b64="$(base64 -w 0 < "$file")"
    else
      src_b64="$(base64 < "$file" | tr -d '\n')"
    fi
    source_pdf="data:application/pdf;base64,${src_b64}"
  fi

  local body
  if [ -n "$pages_payload" ]; then
    body="$(EXTRACTO_PP_TEMPLATE="${pp_template:-}" EXTRACTO_PP_TARGET="${pp_target_lang:-}" EXTRACTO_PP_MODEL="${pp_model:-}" EXTRACTO_PP_FORMAT="${pp_format:-}" python3 -c '
import json, sys
data = sys.stdin.read().split("\x1f")
file_name, model, page_numbers_csv, pages_concat, preset, prefer_text_layer, source_pdf, page_concurrency = data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]
pages = pages_concat.split("\x1e") if pages_concat else []
page_numbers = [int(n) for n in page_numbers_csv.split(",") if n]
preview = pages[0] if pages else ""
file_entry = {"fileName": file_name, "model": model, "preview": preview, "pages": pages, "pageNumbers": page_numbers}
if source_pdf:
    file_entry["sourcePdf"] = source_pdf
settings = {}
if preset:
    settings["documentPreset"] = preset
if prefer_text_layer:
    settings["preferTextLayer"] = prefer_text_layer == "true"
if page_concurrency:
    settings["pageConcurrency"] = int(page_concurrency)
if settings:
    file_entry["settings"] = settings
import os
pp_template = os.environ.get("EXTRACTO_PP_TEMPLATE", "")
pp_target = os.environ.get("EXTRACTO_PP_TARGET", "")
pp_model_v = os.environ.get("EXTRACTO_PP_MODEL", "")
pp_format_v = os.environ.get("EXTRACTO_PP_FORMAT", "")
if pp_template or pp_target or pp_model_v:
    pp = {"enabled": True}
    if pp_template:
        pp["template"] = pp_template
    if pp_target:
        pp["targetLanguage"] = pp_target
    if pp_model_v:
        pp["model"] = pp_model_v
    if pp_format_v:
        pp["outputFormat"] = pp_format_v
    file_entry["postProcessing"] = pp
print(json.dumps({"files": [file_entry]}, separators=(",", ":")))
' <<<"${file_basename}"$'\x1f'"${model}"$'\x1f'"${page_numbers_list}"$'\x1f'"${pages_payload}"$'\x1f'"${preset}"$'\x1f'"${prefer_text_layer}"$'\x1f'"${source_pdf}"$'\x1f'"${page_concurrency}")"
  else
    body="$(EXTRACTO_PP_TEMPLATE="${pp_template:-}" EXTRACTO_PP_TARGET="${pp_target_lang:-}" EXTRACTO_PP_MODEL="${pp_model:-}" EXTRACTO_PP_FORMAT="${pp_format:-}" python3 -c '
import json, sys
data = sys.stdin.read().split("\x1f")
file_name, model, preview, preset, prefer_text_layer, source_pdf, page_concurrency = data[0], data[1], data[2], data[3], data[4], data[5], data[6]
file_entry = {"fileName": file_name, "model": model, "preview": preview}
if source_pdf:
    file_entry["sourcePdf"] = source_pdf
settings = {}
if preset:
    settings["documentPreset"] = preset
if prefer_text_layer:
    settings["preferTextLayer"] = prefer_text_layer == "true"
if page_concurrency:
    settings["pageConcurrency"] = int(page_concurrency)
if settings:
    file_entry["settings"] = settings
import os
pp_template = os.environ.get("EXTRACTO_PP_TEMPLATE", "")
pp_target = os.environ.get("EXTRACTO_PP_TARGET", "")
pp_model_v = os.environ.get("EXTRACTO_PP_MODEL", "")
pp_format_v = os.environ.get("EXTRACTO_PP_FORMAT", "")
if pp_template or pp_target or pp_model_v:
    pp = {"enabled": True}
    if pp_template:
        pp["template"] = pp_template
    if pp_target:
        pp["targetLanguage"] = pp_target
    if pp_model_v:
        pp["model"] = pp_model_v
    if pp_format_v:
        pp["outputFormat"] = pp_format_v
    file_entry["postProcessing"] = pp
print(json.dumps({"files": [file_entry]}, separators=(",", ":")))
' <<<"${file_basename}"$'\x1f'"${model}"$'\x1f'"${preview_payload}"$'\x1f'"${preset}"$'\x1f'"${prefer_text_layer}"$'\x1f'"${source_pdf}"$'\x1f'"${page_concurrency}")"
  fi

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
      [ -n "$job_id" ] || die "usage: extracto kb export <job-id> --collection NAME --store-url URL --embed-model MODEL [--strategy fixed|sentence|paragraph|hierarchical|semantic] [--chunk-size N] [--overlap N] [--breakpoint-percentile N] [--max-heading-depth N] [--embed-concurrency N]"
      shift
      local collection="" store_url="" store_kind="chroma" store_key="" \
            embed_model="" embed_provider="ollama" embed_endpoint="http://127.0.0.1:11434" embed_key="" \
            strategy="paragraph" chunk_size=1200 overlap="" min_chunk_size=0 \
            breakpoint_percentile="" max_heading_depth="" embed_concurrency=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --collection)            collection="${2:-}"; shift 2 ;;
          --store)                 store_kind="${2:-}"; shift 2 ;;
          --store-url)             store_url="${2:-}"; shift 2 ;;
          --store-key)             store_key="${2:-}"; shift 2 ;;
          --embed-model)           embed_model="${2:-}"; shift 2 ;;
          --embed-provider)        embed_provider="${2:-}"; shift 2 ;;
          --embed-endpoint)        embed_endpoint="${2:-}"; shift 2 ;;
          --embed-key)             embed_key="${2:-}"; shift 2 ;;
          --strategy)              strategy="${2:-}"; shift 2 ;;
          --chunk-size)            chunk_size="${2:-}"; shift 2 ;;
          --overlap)               overlap="${2:-}"; shift 2 ;;
          --min-chunk-size)        min_chunk_size="${2:-}"; shift 2 ;;
          --breakpoint-percentile) breakpoint_percentile="${2:-}"; shift 2 ;;
          --max-heading-depth)     max_heading_depth="${2:-}"; shift 2 ;;
          --embed-concurrency)
            embed_concurrency="${2:-}"
            case "$embed_concurrency" in
              ''|*[!0-9]*) die "--embed-concurrency must be a positive integer (got '${embed_concurrency}')" ;;
            esac
            if [ "$embed_concurrency" -lt 1 ] || [ "$embed_concurrency" -gt 16 ]; then
              die "--embed-concurrency must be between 1 and 16"
            fi
            shift 2
            ;;
          *) die "unknown kb export flag: $1" ;;
        esac
      done
      [ -n "$collection" ]   || die "--collection is required"
      [ -n "$store_url" ]    || die "--store-url is required"
      [ -n "$embed_model" ]  || die "--embed-model is required"

      local body
      body="$(python3 -c '
import json, sys
parts = sys.stdin.read().rstrip("\n").split("\x1f")
(job_id, collection, store_kind, store_url, store_key,
 embed_provider, embed_endpoint, embed_key, embed_model,
 strategy, chunk_size, overlap, min_chunk_size,
 breakpoint_percentile, max_heading_depth, embed_concurrency) = parts

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
if overlap and strategy == "fixed":
  payload["chunking"]["overlap"] = int(overlap)
if int(min_chunk_size) > 0:
  payload["chunking"]["minChunkSize"] = int(min_chunk_size)
if breakpoint_percentile:
  payload["chunking"]["breakpointPercentile"] = float(breakpoint_percentile)
if max_heading_depth:
  payload["chunking"]["maxHeadingDepth"] = int(max_heading_depth)
if embed_concurrency:
  payload["embeddingConcurrency"] = int(embed_concurrency)

print(json.dumps(payload, separators=(",", ":")))
' <<<"${job_id}"$'\x1f'"${collection}"$'\x1f'"${store_kind}"$'\x1f'"${store_url}"$'\x1f'"${store_key}"$'\x1f'"${embed_provider}"$'\x1f'"${embed_endpoint}"$'\x1f'"${embed_key}"$'\x1f'"${embed_model}"$'\x1f'"${strategy}"$'\x1f'"${chunk_size}"$'\x1f'"${overlap}"$'\x1f'"${min_chunk_size}"$'\x1f'"${breakpoint_percentile}"$'\x1f'"${max_heading_depth}"$'\x1f'"${embed_concurrency}")"

      info "exporting job ${job_id} to ${store_kind}://${store_url}/${collection}..."
      api_post_json "/api/v1/export/kb" "$body"
      ;;
    test-connection)
      local store_kind="chroma" store_url="" store_key=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --store)     store_kind="${2:-}"; shift 2 ;;
          --store-url) store_url="${2:-}"; shift 2 ;;
          --store-key) store_key="${2:-}"; shift 2 ;;
          *) die "unknown kb test-connection flag: $1" ;;
        esac
      done
      [ -n "$store_url" ] || die "usage: extracto kb test-connection --store chroma|qdrant|weaviate|milvus|opensearch|pinecone --store-url URL [--store-key KEY]"
      local tc_body
      tc_body="$(python3 -c '
import json, sys
kind, base_url, api_key = sys.stdin.read().split("\x1f")
payload = {"kind": kind, "baseUrl": base_url}
if api_key:
    payload["apiKey"] = api_key
print(json.dumps(payload, separators=(",", ":")))
' <<<"${store_kind}"$'\x1f'"${store_url}"$'\x1f'"${store_key}")"
      info "testing ${store_kind} at ${store_url}..."
      api_post_json "/api/v1/kb/test-connection" "$tc_body"
      ;;
    *)
      die "usage: extracto kb {export|test-connection} [flags]"
      ;;
  esac
}

cmd_s3() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    export)
      local job_id="${1:-}"
      [ -n "$job_id" ] || die "usage: extracto s3 export <job-id> [--prefix SUBPREFIX]"
      shift
      local prefix=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --prefix) prefix="${2:-}"; shift 2 ;;
          *) die "unknown s3 export flag: $1" ;;
        esac
      done
      local body
      if [ -n "$prefix" ]; then
        body="{\"jobId\":\"${job_id}\",\"keyPrefix\":\"${prefix}\",\"wait\":true}"
      else
        body="{\"jobId\":\"${job_id}\",\"wait\":true}"
      fi
      info "exporting job ${job_id} to S3..."
      api_post_json "/api/v1/export/s3" "$body"
      ;;
    ls|list)
      local prefix="" page_size="" token="" all=0
      while [ $# -gt 0 ]; do
        case "$1" in
          --prefix)    prefix="${2:-}"; shift 2 ;;
          --page-size) page_size="${2:-}"; shift 2 ;;
          --token)     token="${2:-}"; shift 2 ;;
          --all)       all=1; shift ;;
          *) die "unknown s3 ls flag: $1" ;;
        esac
      done
      local query=""
      [ -n "$prefix" ] && query="${query}&prefix=$(printf '%s' "$prefix" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')"
      [ -n "$page_size" ] && query="${query}&pageSize=${page_size}"
      [ -n "$token" ] && query="${query}&token=$(printf '%s' "$token" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')"
      [ "$all" -eq 1 ] && query="${query}&all=1"
      query="${query#&}"
      local path="/api/v1/s3/list"
      [ -n "$query" ] && path="${path}?${query}"
      api_get "$path"
      ;;
    download|dl)
      local key="${1:-}"
      local out="${2:-}"
      [ -n "$key" ] || die "usage: extracto s3 download <key> [out-file]"
      [ -n "$out" ] || out="$(basename "$key")"
      info "downloading ${key} -> ${out}..."
      api_get_raw "/api/v1/s3/download?key=$(printf '%s' "$key" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')" "$out"
      ok "saved ${out}"
      ;;
    *)
      die "usage: extracto s3 {export|ls|download} [flags]"
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
  on [--build]                  Start Extracto. Default pulls the published
                                image from ghcr.io/codelined-ag/extracto.
                                Pass --build to build locally from source.
  off                           Stop Extracto (animated status)
  upgrade                       Pull the latest image and recreate the container
  status                        Show running container state
  logs                          Tail app logs (docker compose logs -f app)
  uninstall                     Remove Extracto command and app resources (keeps Ollama)

API keys (require running container):
  api-key create <email> <name> Create an API key for a user
  api-key list <email>          List API keys for a user
  api-key revoke <key-id>       Revoke an API key by id

Headless API (requires EXTRACTO_TOKEN env or ~/.extracto/config):
  ocr <file> --model N [--out P] [--no-wait] [--pages 1-5,7]
                                  [--preset generic|academic|invoice|contract|form]
                                  [--no-text-layer]
                                Submit a file for OCR (pdf/png/jpg/webp)
  jobs list [limit] [--status S] [--q TEXT] [--model TEXT] [--from DATE] [--to DATE] [--tags id,id]
                                List recent OCR jobs (default 20). Filters AND-combine; --tags is comma-separated and OR-combines within itself.
  jobs get <id>                 Show one job
  jobs delete <id>              Delete a job
  jobs cancel <id>              Request a job stop
  jobs wait <id>                Poll until the job leaves QUEUED/RUNNING
  jobs edit-page <id> <n> (--text TEXT | --from-file PATH)
                                Replace the markdown text of page n on a COMPLETED job. Previous text is added to the per-page history.
  jobs page-history <id> <n>    Show the edit history for page n
  jobs set-tags <id> [tag-id...]  Replace the tags applied to a job
  jobs bulk-tag --jobs id,id,... --tags id,id,... [--mode add|replace]
                                Apply tags to many jobs at once (default mode add = union).
                                Mode replace clears existing tags first; mode replace with --tags "" strips all tags from those jobs.
  tags list                     List the caller's tags
  tags create <name> [color]    Create or recolor a tag (slate|blue|green|yellow|orange|red|pink|purple)
  tags update <id> [--name X] [--color C]
  tags delete <id>              Delete a tag (cascades job associations)
  presets list                  List output presets
  presets create <name> <inst> [markdown|json]
  presets delete <id>
  searches list                 List saved History searches
  searches save <name> [--q TEXT] [--status S] [--from DATE] [--to DATE] [--model TEXT] [--tags id,id]
                                Save the given filter set as a named search (idempotent on name).
  searches rename <id> <name>   Rename a saved search without rewriting its filters
  searches delete <id>          Delete a saved search
  settings get                  Show current API provider settings
  kb export <job-id> --collection N --store-url URL --embed-model M
                                Export an OCR job's text to a vector store
  kb test-connection --store chroma|qdrant|weaviate|milvus|opensearch|pinecone|typesense --store-url URL [--store-key KEY]
                                Probe a vector store for reachability + auth
                                before running an export
  s3 export <job-id> [--prefix SUBPREFIX]
                                Upload an OCR job's markdown + JSON to the
                                configured user S3 bucket
  s3 ls [--prefix P] [--page-size N] [--token T] [--all]
                                List objects in the configured S3 bucket
                                (filtered to OCR-able extensions by default)
  s3 download <key> [out-file]  Stream an S3 object to a local file

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
    on)        shift; cmd_on "$@" ;;
    off)       cmd_off ;;
    upgrade)   cmd_upgrade ;;
    status)    cmd_status ;;
    logs)      cmd_logs ;;
    api-key)   shift; cmd_api_key "$@" ;;
    uninstall) cmd_uninstall ;;
    ocr)       shift; cmd_ocr "$@" ;;
    estimate)  shift; cmd_estimate "$@" ;;
    compare)   shift; cmd_compare "$@" ;;
    recommend) shift; cmd_recommend "$@" ;;
    redact)    shift; cmd_redact "$@" ;;
    jobs)      shift; cmd_jobs "$@" ;;
    tags)      shift; cmd_tags "$@" ;;
    presets)   shift; cmd_presets "$@" ;;
    searches)  shift; cmd_searches "$@" ;;
    settings)  shift; cmd_settings "$@" ;;
    kb)        shift; cmd_kb "$@" ;;
    s3)        shift; cmd_s3 "$@" ;;
    dropbox)   shift; cmd_dropbox "$@" ;;
    gdrive)    shift; cmd_gdrive "$@" ;;
    onedrive)  shift; cmd_onedrive "$@" ;;
    -h|--help|help|"")
      print_help
      ;;
    *)
      die "unknown command '${command}'. Run 'extracto --help'."
      ;;
  esac
}

main "$@"
