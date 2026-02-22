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

## Ollama Host Connectivity

Default in this project is host networking:

- `APP_NETWORK_MODE=host`
- `OLLAMA_HOST=http://127.0.0.1:11434`

If using bridge mode, host Ollama must be reachable from container network. Typical setup:

- Host Ollama bind: `0.0.0.0:11434`
- App endpoint: `http://host.docker.internal:11434`

## Authentication

The application is gated by `/auth` with free signup enabled.

API endpoints:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/signout`
- `GET /api/auth/session`

## OCR and Jobs API (High Level)

- `POST /api/ocr`: process a file/pages.
  - Supports `mode: "ocr" | "pdf_to_obsidian"` plus `obsidian` export settings.
- `GET /api/models`: discover models from configured host.
- `GET /api/jobs`: list user OCR jobs.
- `GET /api/jobs/:id`: get OCR job detail.
- `DELETE /api/jobs/:id`: delete OCR job.
- `GET /api/settings` and `POST /api/settings`: persistent API settings.

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
- Rotate `AUTH_SECRET` for production.
- Use HTTPS and set `COOKIE_SECURE=true` in production.

## License

No license file is currently included in this repository.
