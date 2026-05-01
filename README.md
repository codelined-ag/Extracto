# Extracto

Extracto is a self-hosted OCR web app with a proper backend, persistent settings, authentication, OCR history, and Docker-first operations.

It supports four model providers — Ollama on your host machine, the Mistral OCR API, OpenRouter, and any **OpenAI-compatible endpoint** (api.openai.com itself, plus self-hosted vLLM / LocalAI / llama.cpp server, Groq, Together, Fireworks, etc.) — plus multi-page PDF extraction and optional AI post-processing.

## Why Extracto

- OCR with local-first or API-first model providers.
- Free signup and auth-gated workspace.
- Per-user OCR history with preview, view, download, and delete.
- Persistent provider settings and API keys.
- Full Docker Compose deployment.
- One-command lifecycle via `extracto on`, `extracto off`, `extracto uninstall`.

## Core Features

- OCR providers:
  - Ollama (`/api/chat` and `/v1/chat/completions` compatible paths).
  - Mistral OCR API.
  - OpenRouter (OpenAI-compatible chat completions with vision; any model in
    the OpenRouter catalog that accepts image inputs).
  - **OpenAI-compatible** — any endpoint that speaks the OpenAI Chat
    Completions wire format with vision content blocks. Works with
    `api.openai.com`, self-hosted vLLM / LocalAI / llama.cpp server, Groq,
    Together, Fireworks, Anyscale, and similar.
- Dynamic model discovery from each configured provider — including live
  OpenRouter and OpenAI-compatible `/models` lookup using the user's saved key.
- Per-user persisted provider settings: provider, endpoint, API key.
- PDF pipeline:
  - Every page is rendered to image first.
  - Each image page is processed via OCR.
  - Output is merged into one final response.
  - No fixed hard page cap in app logic.
- Optional post-processing stage:
  - Custom instruction input.
  - Output mode: `Markdown` or structured `JSON`.
  - Runs after OCR extraction.
- Past OCR runs modal:
  - Run list with status.
  - Detail view.
  - Download markdown/json.
  - Delete previous runs.

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Prisma + SQLite
- Bun runtime (containerized build/runtime)
- Tailwind + shadcn/ui
- Docker + Docker Compose

## Quick Start

### Option 1: One-command installer (recommended)

```bash
./install-extracto.sh
```

Installer responsibilities:

- Installs Docker if missing.
- Installs Ollama if missing.
- Installs the `extracto` command under `~/.local/bin/extracto`.
- Adds shell alias block in `~/.bashrc` and `~/.zshrc`.
- Builds and starts the stack.

Then use:

```bash
extracto on
extracto off
extracto uninstall
```

`extracto uninstall` removes Extracto command and app containers/volumes, but keeps Ollama installed.

### Option 2: Manual Docker Compose

```bash
docker compose --env-file docker.env up -d --build
docker compose ps
docker compose logs -f app
```

Stop:

```bash
docker compose --env-file docker.env down
```

## Configuration

Primary runtime config is in `docker.env`.

Important variables:

- `AUTH_SECRET`: required for production auth cookie signing.
- `COOKIE_SECURE`: `false` for local HTTP, `true` behind HTTPS.
- `APP_NETWORK_MODE`: `host` (default here) or `bridge`.
- `OLLAMA_HOST`: Ollama base URL used by backend discovery and OCR calls.
- `OLLAMA_HOST_FALLBACKS`: optional comma-separated fallback hosts.
- `OPENROUTER_API_URL`: override base URL (default `https://openrouter.ai/api/v1`).
- `OPENROUTER_API_KEY`: optional fallback key when a user has not saved one.
- `OPENROUTER_REFERER` / `OPENROUTER_TITLE`: sent as `HTTP-Referer` / `X-Title`
  for OpenRouter analytics.
- `OPENROUTER_MODELS`: optional comma-separated fallback model list.
- `OPENAI_COMPAT_API_URL`: base URL placeholder shown when "OpenAI-compatible"
  is selected (default `https://api.openai.com/v1`). Users override per
  account from the Settings → API dialog.
- `OPENAI_COMPAT_API_KEY`: optional fallback API key when a user has not
  saved one.
- `OPENAI_COMPAT_MODELS`: optional comma-separated fallback model list shown
  when `/models` discovery fails (e.g. for servers that don't expose it).
- `OLLAMA_ALLOWED_HOSTS` / `MISTRAL_ALLOWED_HOSTS` / `OPENROUTER_ALLOWED_HOSTS`
  / `OPENAI_COMPAT_ALLOWED_HOSTS`: optional comma-separated allowlists for
  provider endpoints. User-submitted endpoints are validated against these
  patterns; defaults cover localhost, docker gateway hosts, `*.mistral.ai`,
  `*.openrouter.ai`, and `*.openai.com`. **Extend
  `OPENAI_COMPAT_ALLOWED_HOSTS` to authorize self-hosted vLLM/LocalAI hosts**
  (e.g. `api.openai.com,my-vllm.internal,groq.com,api.together.xyz`).

## Ollama Host Connectivity

Default in this project is host networking:

- `APP_NETWORK_MODE=host`
- `OLLAMA_HOST=http://127.0.0.1:11434`

If using bridge mode, host Ollama must be reachable from container network. Typical setup:

- Host Ollama bind: `0.0.0.0:11434`
- App endpoint: `http://host.docker.internal:11434`

## Authentication

The application is gated by `/auth` with free signup enabled. Two
authentication methods are supported:

1. **Session cookie** — used by the browser UI. Sign in at `/auth`.
2. **API key (Bearer token)** — for headless / server-to-server use. Send as
   `Authorization: Bearer extr_...` on any `/api/*` request.

Session-based mutations are CSRF-protected via origin/referer checks. API-key
requests skip that check (no implicit credentials in non-browser clients).

Auth endpoints:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/signout`
- `GET /api/auth/session`

## Providers

Four providers are supported. Each is configured per user from the UI
(Settings → API), and the same configuration is used by both the browser UI
and the headless API.

| Provider | Endpoint | API key required | Model discovery |
|---|---|---|---|
| Ollama | local or remote `http://host:11434` | no | `GET /api/tags` (or `/v1/models`) |
| Mistral OCR API | `https://api.mistral.ai/v1/ocr` | yes | static catalog (configurable via `MISTRAL_MODELS`) |
| OpenRouter | `https://openrouter.ai/api/v1` | yes | live `GET /models` using the saved key |
| OpenAI-compatible | any base URL (default `https://api.openai.com/v1`) | yes | live `GET /models` using the saved key |

For OpenRouter, any vision-capable model in the catalog can be used (e.g.
`anthropic/claude-3.5-sonnet`, `openai/gpt-4o`, `google/gemini-2.0-flash-001`,
`qwen/qwen-2-vl-72b-instruct`). The dynamic catalog refreshes every five
minutes; if discovery fails, a configurable fallback list is shown.

The **OpenAI-compatible** provider lets you point at any server that speaks
the OpenAI Chat Completions wire format with vision content blocks: the real
`api.openai.com`, a self-hosted [vLLM](https://github.com/vllm-project/vllm)
or [LocalAI](https://localai.io) instance, [Groq](https://groq.com),
[Together](https://together.ai), [Fireworks](https://fireworks.ai),
[Anyscale](https://anyscale.com), etc. Requests use a bare
`Authorization: Bearer <key>` (no `X-Title` / `HTTP-Referer` headers — those
are OpenRouter-specific and trip strict OpenAI servers). The base path you
paste into the endpoint field is preserved verbatim — `/v1`, `/openai/v1`,
or whatever your server uses. Set `OPENAI_COMPAT_ALLOWED_HOSTS` to authorize
self-hosted endpoints (defaults to `api.openai.com` only).

## Headless API

Extracto can be deployed as a headless OCR service: the same HTTP API powers
the UI and accepts API-key Bearer auth for non-browser clients.

### Provisioning an API key

API keys are scoped to a single user, stored only as an HMAC-SHA256 hash
(keyed by `AUTH_SECRET`), and shown in plaintext exactly once at creation.
Each key carries a **scope list** and an optional **per-key rate limit**.

**Headless (CLI, no UI required):**

```bash
# Default: scope "*" (all), default rate limit (global per-user)
extracto api-key create user@example.com "ci-runner"

# Restricted: only OCR submit + read, 30 req/min
extracto api-key create user@example.com "batch-runner" \
  --scopes=ocr:submit,ocr:read --rate-limit=30

extracto api-key list   user@example.com
extracto api-key revoke <key-id>
```

The CLI runs inside the running container via `docker compose exec`, so the
container must be up. The user must already exist (sign up via the UI once,
or insert an `AuthUser` row directly).

**From an authenticated browser session:**

```bash
# Create with scopes + per-key limit
curl -X POST http://localhost:3000/api/v1/keys \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "name": "ci-runner",
    "scopes": ["ocr:submit", "ocr:read"],
    "rateLimitPerMinute": 30
  }'

# List (also returns availableScopes catalog)
curl http://localhost:3000/api/v1/keys -b cookies.txt

# Revoke
curl -X DELETE http://localhost:3000/api/v1/keys/<id> -b cookies.txt
```

API keys cannot create or revoke other API keys — that path is session-only
to keep the blast radius of a leaked key bounded to OCR work.

**Available scopes:**

| Scope | Grants |
|---|---|
| `*` | Everything below |
| `ocr:submit` | `POST /api/ocr`, batch, OpenAI adapter |
| `ocr:read` | List jobs, read job detail, model catalog, SSE stream |
| `ocr:control` | Delete jobs, stop running jobs |
| `settings:read` / `settings:write` | Per-user provider settings + global OCR tuning |
| `webhooks:read` / `webhooks:write` | Webhook CRUD |
| `presets:read` / `presets:write` | Output preset CRUD |
| `search:read` | Job-history search |

### Submit an OCR job and poll

```bash
# 1. Discover available models
curl -s http://localhost:3000/api/models \
  -H "Authorization: Bearer $EXTRACTO_API_KEY"

# 2. Submit an OCR job (PDF as base64-encoded data URL or image preview)
curl -s -X POST http://localhost:3000/api/ocr \
  -H "Authorization: Bearer $EXTRACTO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "invoice.pdf",
    "model": "minicpm-v",
    "preview": "data:application/pdf;base64,JVBERi0xLjQK...",
    "mode": "ocr"
  }'
# → { "jobId": "...", "status": "QUEUED", ... }

# 3. Poll for completion
curl -s "http://localhost:3000/api/jobs/$JOB_ID" \
  -H "Authorization: Bearer $EXTRACTO_API_KEY"
# → { "job": { "status": "COMPLETED", "extractedText": "...", "result": {...} } }
```

Per-user OCR rate limit: 6 jobs per 60s window by default. API keys with a
configured `rateLimitPerMinute` use that limit instead, keyed by the API key
itself (not by user+IP).

### Stream progress with SSE

Instead of polling, open a persistent stream. Each progress update is an SSE
event; the stream closes automatically when the job hits a terminal state.

```bash
curl -N -H "Authorization: Bearer $EXTRACTO_API_KEY" \
  http://localhost:3000/api/jobs/$JOB_ID/stream

# event: hello
# data: {"jobId":"..."}
#
# event: progress
# data: {"id":"...","status":"PROCESSING","metadata":{...},"updatedAt":"..."}
#
# event: done
# data: {"id":"...","status":"COMPLETED"}
```

### Bulk import

Submit up to 50 files in a single request, sharing one `batchId`:

```bash
curl -X POST http://localhost:3000/api/v1/ocr/batch \
  -H "Authorization: Bearer $EXTRACTO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "files": [
      {"fileName": "invoice-1.pdf", "preview": "data:...", "model": "minicpm-v"},
      {"fileName": "invoice-2.pdf", "preview": "data:...", "model": "minicpm-v", "priority": 5}
    ]
  }'
# → { "batchId": "batch_...", "submissions": [{"fileName":..., "jobId":...}, ...] }
```

`priority` (-10..10, default 0) controls queue order when concurrent
submissions exceed `OCR_WORKER_CONCURRENCY`.

### OpenAI-compatible adapter

Point existing OpenAI-SDK code at Extracto for OCR by setting the base URL
to `/api/v1/openai`:

```bash
curl -X POST http://localhost:3000/api/v1/openai/chat/completions \
  -H "Authorization: Bearer $EXTRACTO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-3.5-sonnet",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Extract all invoice line items as a markdown table."},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }]
  }'
```

The adapter blocks until the OCR job completes (up to 5 minutes), then
returns the OpenAI Chat Completions response shape with the extracted text
in `choices[0].message.content`.

### Webhooks

Subscribe to `job.completed` and `job.failed` events. Each delivery is signed
with HMAC-SHA256 in the `X-Extracto-Signature: t=<unix-ts>,v1=<hex>` header
(Stripe-style); the signed payload is `${ts}.${body}`.

```bash
# Create
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H "Authorization: Bearer $EXTRACTO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.example/extracto-hook", "events": ["job.completed"]}'
# → { "webhook": { "id":..., "secret":"whsec_..." }, "warning": "..." }
# (the secret is shown once — store it now)

# List / disable / delete
curl http://localhost:3000/api/v1/webhooks -H "Authorization: Bearer $EXTRACTO_API_KEY"
curl -X PATCH http://localhost:3000/api/v1/webhooks/<id> -H "..." -d '{"active": false}'
curl -X DELETE http://localhost:3000/api/v1/webhooks/<id> -H "..."
```

### History search

```bash
curl "http://localhost:3000/api/v1/search?q=invoice&limit=10" \
  -H "Authorization: Bearer $EXTRACTO_API_KEY"
# → { "q":"invoice", "count":..., "results":[{ "id":..., "snippet":"…invoice #123…" }] }
```

LIKE-based for v1; FTS5 is a future improvement.

### Output presets

Save and reuse post-processing recipes (custom instruction + output format):

```bash
# Create
curl -X POST http://localhost:3000/api/v1/presets \
  -H "Authorization: Bearer $EXTRACTO_API_KEY" \
  -d '{"name":"Invoice → JSON line items","instruction":"Extract line items as JSON array of {description, qty, price}","outputFormat":"json"}'

# List / update / delete
curl http://localhost:3000/api/v1/presets -H "Authorization: ..."
curl -X PATCH http://localhost:3000/api/v1/presets/<id> -H "..." -d '{"name":"..."}'
curl -X DELETE http://localhost:3000/api/v1/presets/<id> -H "..."
```

### Endpoint reference

| Endpoint | Methods | Auth | Required scope (api-key) |
|---|---|---|---|
| `/api/health` | GET | public | — |
| `/api/auth/*` | POST/GET | session only | — |
| `/api/v1/keys` | GET, POST | session only | — |
| `/api/v1/keys/:id` | DELETE | session only | — |
| `/api/v1/webhooks` | GET, POST | session or Bearer | `webhooks:read` / `webhooks:write` |
| `/api/v1/webhooks/:id` | PATCH, DELETE | session or Bearer | `webhooks:write` |
| `/api/v1/presets` | GET, POST | session or Bearer | `presets:read` / `presets:write` |
| `/api/v1/presets/:id` | PATCH, DELETE | session or Bearer | `presets:write` |
| `/api/v1/ocr/batch` | POST | session or Bearer | `ocr:submit` |
| `/api/v1/openai/chat/completions` | POST | session or Bearer | `ocr:submit` |
| `/api/v1/search` | GET | session or Bearer | `search:read` |
| `/api/v1/metrics` | GET | `METRICS_TOKEN` | — |
| `/api/ocr` | GET, POST | session or Bearer | `ocr:read` (GET) / `ocr:submit` (POST) |
| `/api/models` | GET | session or Bearer | `ocr:read` |
| `/api/jobs` | GET, DELETE | session or Bearer | `ocr:read` / `ocr:control` |
| `/api/jobs/:id` | GET, DELETE | session or Bearer | `ocr:read` / `ocr:control` |
| `/api/jobs/:id/stream` | GET (SSE) | session or Bearer | `ocr:read` |
| `/api/jobs/:id/control` | POST | session or Bearer | `ocr:control` |
| `/api/settings` | GET, POST | session or Bearer | `settings:read` / `settings:write` |
| `/api/ocr/settings` | GET, PUT | session or Bearer | `settings:read` / `settings:write` |

## Service-mode operations

Knobs that mostly matter when Extracto runs as an unattended API service.

### Result storage (S3 / MinIO)

By default, OCR results are stored inline in SQLite (`extractedText` column +
`result` JSON). For large workloads, offload to S3-compatible object storage:

```bash
# docker.env
RESULT_STORAGE=s3
S3_BUCKET=extracto-results
S3_REGION=us-east-1
S3_ENDPOINT=https://s3.amazonaws.com         # or e.g. http://minio:9000 for MinIO
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PREFIX=extracto                            # key prefix
S3_FORCE_PATH_STYLE=false                     # set true for MinIO
```

When `RESULT_STORAGE=s3`, completed jobs upload `extractedText` and the
result JSON to S3 and store an `s3://...` reference in the DB. Reads are
transparent — `GET /api/jobs/:id` resolves the S3 reference and returns
inline JSON.

### Priority queue

Concurrent OCR submissions are admitted by a priority semaphore.

- `OCR_WORKER_CONCURRENCY` (default `2`): max simultaneous jobs.
- Per-job `priority` body field, range `-10..10` (default `0`). Higher wins
  when the queue is contended. Lower priorities are useful for the watched
  folder and bulk imports so they don't crowd interactive UI users.

Stop requests are durable: `POST /api/jobs/:id/control { "action": "stop" }`
flips `OcrJob.stopRequestedAt`, the running pipeline polls for it once per
page and pauses with a resumable checkpoint.

### Job retention

```bash
RETAIN_JOBS_DAYS=30   # delete jobs older than 30 days; sweeps every 24h
```

`0` (default) disables retention. The sweep removes both DB rows and any
S3 artifacts they referenced.

### Watched-folder ingestion

Drop PDFs/images into a host-mounted directory and have them auto-OCR'd:

```bash
# docker.env
WATCH_FOLDER=/host-watch
WATCH_FOLDER_USER_EMAIL=ops@example.com
WATCH_FOLDER_API_KEY=extr_...                 # a real key minted for that user
WATCH_FOLDER_MODEL=minicpm-v                  # or any provider model
WATCH_FOLDER_PROVIDER=ollama                  # optional override
WATCH_FOLDER_INTERVAL_MS=30000                # poll interval (min 5000)
```

Supported extensions: `.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`. A
`.extracto.done` sidecar marks each completed file so it isn't reprocessed.
Watched-folder jobs run at priority `-2` so interactive submissions still cut
ahead.

### Prometheus metrics

```bash
METRICS_TOKEN=$(openssl rand -hex 32)
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3000/api/v1/metrics
```

Returns Prometheus exposition with job counts by status, queue depth, and
in-process counters (provider errors, OpenRouter cache hit/miss, webhook
delivery counts). Returns `503` if `METRICS_TOKEN` is unset.

## Local Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Project Structure

```text
src/
  app/
    api/        # OCR, auth, models, settings, history endpoints
    auth/       # Auth page
    page.tsx    # Main OCR UI
  lib/
    auth/       # Session token helpers
    db.ts       # Prisma client
    settings-store.ts
    host-normalization.ts
prisma/
  schema.prisma
docker-compose.yml
docker-entrypoint.sh
install-extracto.sh
scripts/extracto.sh
```

## Troubleshooting

### Models are not discovered

- Confirm Ollama is running:

```bash
curl -fsS http://127.0.0.1:11434/api/version
```

- Confirm app effective env:

```bash
docker compose --env-file docker.env config
```

- If bridge mode is used, ensure host bind is not loopback-only.

### App starts but auth fails in browser

- Ensure `COOKIE_SECURE=false` for plain HTTP local usage.
- Set a valid `AUTH_SECRET` and restart the app container.

## Security Notes

- Do not commit real API keys.
- Rotate `AUTH_SECRET` for production. Rotating invalidates all existing API
  keys (their stored hashes are HMAC-keyed by `AUTH_SECRET`) — re-issue keys
  after rotation. Webhook signing secrets are NOT keyed by `AUTH_SECRET` and
  survive rotation.
- Use HTTPS and set `COOKIE_SECURE=true` in production.
- Provider endpoints are validated against `OLLAMA_ALLOWED_HOSTS` /
  `MISTRAL_ALLOWED_HOSTS` / `OPENROUTER_ALLOWED_HOSTS` allowlists.
  User-supplied endpoints outside the allowlist are rejected.
- API key listing/creation/revocation is session-only — even a key with the
  `*` scope cannot mint or revoke other keys.
- Webhook bodies are HMAC-SHA256 signed with a per-webhook secret. Verify
  with the `X-Extracto-Signature` header (`t=<unix-ts>,v1=<hex>` over
  `${ts}.${body}`).
- AbortController-based cancellation is in-process; the durable
  `stopRequestedAt` flag works across replicas, but the abort signal itself
  reaches only the process that owns the running job.

## License

No license file is currently included in this repository.
