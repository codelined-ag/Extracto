# Extracto

Extracto is a self-hosted OCR web app with a proper backend, persistent settings, authentication, OCR history, and Docker-first operations.

It supports Ollama on your host machine, Mistral OCR API, multi-page PDF extraction, optional AI post-processing, and a `PDF → Obsidian` mode that creates vaults automatically.

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
- Dynamic model discovery from configured host endpoint.
- PDF pipeline:
  - Every page is rendered to image first.
  - Each image page is processed via OCR.
  - Output is merged into one final response.
  - No fixed hard page cap in app logic.
- Optional post-processing stage:
  - Custom instruction input.
  - Output mode: `Markdown` or structured `JSON`.
  - Runs after OCR extraction.
- `PDF → Obsidian` mode:
  - Forces a full-document analysis step after OCR.
  - Produces topic-organized notes/folders.
  - Writes a new Obsidian vault to a host-mounted directory.
  - Stores vault path metadata in job history/results.
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
- `OBSIDIAN_EXPORT_BASE_DIR`: container path where vault exports are written.
- `OBSIDIAN_EXPORT_HOST_ROOT`: host path bind-mounted to `OBSIDIAN_EXPORT_BASE_DIR`.
- `OLLAMA_ALLOWED_HOSTS` / `MISTRAL_ALLOWED_HOSTS`: optional comma-separated
  allowlists for provider endpoints. User-supplied endpoints outside these
  patterns are rejected; defaults cover localhost, docker gateway hosts, and
  `*.mistral.ai`.

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

## Headless API

Extracto can be deployed as a headless OCR service: the same HTTP API powers
the UI and accepts API-key Bearer auth for non-browser clients.

### Provisioning an API key

API keys are scoped to a single user, stored only as an HMAC-SHA256 hash
(keyed by `AUTH_SECRET`), and shown in plaintext exactly once at creation.

**Headless (CLI, no UI required):**

```bash
extracto api-key create user@example.com "ci-runner"
extracto api-key list   user@example.com
extracto api-key revoke <key-id>
```

The CLI runs inside the running container via `docker compose exec`, so the
container must be up. The user must already exist (sign up via the UI once,
or insert an `AuthUser` row directly).

**From an authenticated browser session:**

```bash
# Create
curl -X POST http://localhost:3000/api/v1/keys \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"ci-runner"}'

# List
curl http://localhost:3000/api/v1/keys -b cookies.txt

# Revoke
curl -X DELETE http://localhost:3000/api/v1/keys/<id> -b cookies.txt
```

API keys cannot create or revoke other API keys — that path is session-only
to keep the blast radius of a leaked key bounded to OCR work.

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

Per-user OCR rate limit: 6 jobs per 60s window.

### Endpoint reference

| Endpoint | Methods | Auth | Notes |
|---|---|---|---|
| `/api/health` | GET | public | Healthcheck |
| `/api/auth/*` | POST/GET | session only | Sign up / log in / sign out |
| `/api/v1/keys` | GET, POST | session only | List / create API keys |
| `/api/v1/keys/:id` | DELETE | session only | Revoke an API key |
| `/api/ocr` | GET, POST | session or Bearer | GET = model catalog; POST = submit job |
| `/api/models` | GET | session or Bearer | Discover models |
| `/api/jobs` | GET, DELETE | session or Bearer | List / bulk-delete jobs |
| `/api/jobs/:id` | GET, DELETE | session or Bearer | Job detail / delete |
| `/api/jobs/:id/control` | POST | session or Bearer | Stop a running job |
| `/api/settings` | GET, POST | session or Bearer | Per-user provider settings |
| `/api/ocr/settings` | GET, PUT | session or Bearer | Global OCR tuning prefs |

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
  after rotation.
- Use HTTPS and set `COOKIE_SECURE=true` in production.
- Provider endpoints are validated against `OLLAMA_ALLOWED_HOSTS` /
  `MISTRAL_ALLOWED_HOSTS` allowlists. User-supplied endpoints outside the
  allowlist are rejected.
- The in-memory job-control registry assumes a single-process deploy. Stop
  requests and abort signals will not propagate across replicas.

## License

No license file is currently included in this repository.
