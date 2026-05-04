---
name: extracto-cli
description: Use when the user wants to extract text from PDFs or images, manage OCR jobs, or work with output presets via the local Extracto OCR webapp. Talks HTTP to a running Extracto instance using the bundled `extracto` CLI.
---

# Extracto CLI — Agent Skill Reference

## What Extracto is

Extracto is a self-hosted OCR webapp that extracts text from PDFs and images using LLMs (Ollama on the host machine, Mistral OCR API, OpenRouter, or any OpenAI-compatible endpoint). It exposes both a browser UI and a stable headless HTTP surface under `/api/v1/`. The `extracto` CLI is a thin Bash wrapper around that HTTP surface plus the Docker lifecycle commands.

## Prerequisites

1. **Container running** — confirm with `extracto status`. If nothing is up, `extracto on` brings it up via `docker compose up -d --build`.
2. **API token** — required for everything under `/api/v1/`. Get one with:
   ```
   extracto api-key create <email> <name>
   ```
   Save the printed key in either:
   - `EXTRACTO_TOKEN` env var, or
   - `~/.extracto/config` as a line `EXTRACTO_TOKEN=<key>`
3. **Base URL** — defaults to `http://127.0.0.1:3000`. Override with `EXTRACTO_URL=https://my.host:port` if Extracto runs elsewhere.

The CLI dies with a clear error if either the URL is unreachable or the token is missing.

## Common workflows

### Extract text from a single file

```bash
extracto ocr ./invoice.pdf --model mistral-ocr-latest
```

The `--model` flag is **required** — `/api/v1/ocr/batch` rejects submissions without one. Pick a model that's available to the user's currently-configured provider (see `extracto settings get`).

The CLI submits the file, polls until the job leaves `QUEUED`/`RUNNING`, and prints the final job JSON. Use `--out result.json` to save instead of printing, `--no-wait` to return as soon as the job is queued.

Supported types: `.pdf`, `.png`, `.jpg`/`.jpeg`, `.webp`. The CLI base64-encodes the file as a data URL and sends it to `POST /api/v1/ocr/batch`. Files larger than 32 MiB are rejected client-side — use the web UI instead, since the OS arg-list limit gets hit before the API does.

### More model examples

```bash
extracto ocr ./scan.png --model llava:13b              # local Ollama
extracto ocr ./report.pdf --model mistral-ocr-latest   # Mistral OCR
extracto ocr ./photo.jpg --model openai/gpt-4o         # via OpenRouter
```

### v0.4.0 quality flags

```bash
extracto ocr ./paper.pdf --model anthropic/claude-3.5-sonnet --pages 1-5,7   # only OCR these pages
extracto ocr ./invoice.pdf --model openai/gpt-4o --preset invoice            # request structured invoice JSON
extracto ocr ./paper.pdf --model anthropic/claude-3.5-sonnet --preset academic
extracto ocr ./scan.pdf --model llava:13b --no-text-layer                    # force vision model even on born-digital PDFs
```

`--preset` accepts `generic`, `academic`, `invoice`, `contract`, `form`. The default is `generic`. Born-digital PDFs use the text-layer fast-path automatically (no VLM call) unless you pass `--no-text-layer`.

### List recent jobs

```bash
extracto jobs list                                         # last 20
extracto jobs list 100                                     # last 100 (max 100)
extracto jobs list --status COMPLETED                      # only completed
extracto jobs list --q invoice                             # fileName contains "invoice" (case-insensitive)
extracto jobs list --model qwen                            # model id contains "qwen"
extracto jobs list --from 2026-01-01 --to 2026-01-31       # createdAt within range (ISO-8601)
extracto jobs list --tags tagid1,tagid2                    # has at least one of these tags
```

Filters AND-combine across distinct keys; `--tags` is comma-separated and OR-combines within itself. Returns a JSON list with id/status/fileName/model/timestamps/preview/tags.

### Inspect or wait on one job

```bash
extracto jobs get <job-id>
extracto jobs wait <job-id>
```

`wait` polls every 2 seconds and prints the final state when the status leaves `QUEUED`/`RUNNING`.

### Cancel or delete a job

```bash
extracto jobs cancel <job-id>   # POSTs {"action":"stop"} to /api/jobs/<id>/control
extracto jobs delete <job-id>   # DELETE /api/jobs/<id>
```

### Tag jobs

Tags are user-owned labels you can attach to jobs to organize the History panel. The CLI talks to `/api/v1/tags` and `/api/v1/jobs/{id}/tags`.

```bash
extracto tags list                            # all tags + jobCount per tag
extracto tags create "Invoices" blue          # color: slate|blue|green|yellow|orange|red|pink|purple
extracto tags update <tag-id> --name "Q1 invoices" --color green
extracto tags delete <tag-id>                 # cascades: also removes from jobs

extracto jobs set-tags <job-id> <tag-id> <tag-id> ...   # replaces the job's tag set
extracto jobs set-tags <job-id>                          # clears all tags (no ids)
```

`jobs list` and `jobs get` include a `tags: [{id, name, color}]` array.

### Manage output presets

Presets are saved post-processing instructions (e.g. "Extract all tables as JSON"). Useful for repeated downstream pipelines.

```bash
extracto presets list
extracto presets create "Tables to JSON" "Extract every table as a JSON array of rows" json
extracto presets delete <preset-id>
```

### Inspect provider settings

```bash
extracto settings get
```

Settings (provider, endpoint, hasApiKey) are per-user and stored on the filesystem next to the SQLite DB. To change them, use the web UI — the CLI deliberately does not write secrets.

### S3-compatible storage

Configure the bucket once via Settings → S3 in the UI (any S3-compatible endpoint: AWS S3, R2, Backblaze, MinIO, Garage, Ceph, SeaweedFS, etc.). Then from the CLI:

```bash
extracto s3 export <job-id>                   # upload one job's md + JSON to S3
extracto s3 export <job-id> --prefix scans    # override the per-job sub-prefix
extracto s3 ls                                # list OCR-able files in the bucket
extracto s3 ls --prefix invoices --all        # any extension under a sub-prefix
extracto s3 download <key> [out-file]         # stream object to disk
```

Endpoint is server-side validated against SSRF (cloud-metadata IPs and link-local always blocked). Loopback / RFC1918 hosts require `S3_ALLOW_LOOPBACK=1` (global) or `S3_ALLOWED_HOSTS=foo.internal,*.bar.internal` (granular).

## Output formats

- All commands emit JSON straight from the API surface — no transformation. Pipe to `jq` for filtering.
- The OCR job result includes:
  - `extractedText` — the final markdown
  - `result` — structured JSON with `pages[]` per-page metadata
  - `metadata` — provider, model, timing, post-processing info

## Lifecycle commands (no token required)

```bash
extracto on        # docker compose up -d --build
extracto off       # docker compose down
extracto status    # docker compose ps
extracto logs      # docker compose logs -f app
extracto uninstall # remove containers, volumes, the CLI symlink, and <repo>/.extracto.env
```

## Knowledge-base export (Chroma / Qdrant / Weaviate)

When the user wants to push extracted text into a vector store for retrieval, use `extracto kb`. Two sub-commands:

```bash
extracto kb test-connection \
  --store chroma|qdrant|weaviate \
  --store-url URL \
  [--store-key KEY]

extracto kb export <job-id> \
  --collection NAME \
  --store-url URL \
  --embed-model MODEL \
  [--store chroma|qdrant|weaviate] \
  [--store-key KEY] \
  [--strategy paragraph|sentence|hierarchical|semantic|fixed]
```

**Always run `kb test-connection` before `kb export`.** The export pipeline chunks, embeds, then upserts: if the store is unreachable or the api-key is wrong, you only find out after the embedding cost. The test-connection probe targets an auth-required endpoint per store (Chroma `/api/v1/collections`, Qdrant `/collections`, Weaviate `/v1/schema`) so a 401 here means the upsert later will also 401. No data is written; safe to call repeatedly.

KB export needs `KB_EXPORT_ENABLED=1` on the server. If `kb export` returns 503, the server has the feature off.

## Error handling

- `✖ no API token found` — set `EXTRACTO_TOKEN` or create `~/.extracto/config`.
- `✖ file not found: X` — local file check before any HTTP call.
- `✖ unsupported file type: X` — only `pdf|png|jpg|jpeg|webp` are accepted.
- `curl: (7) Failed to connect` — the container isn't running. Run `extracto on` first.
- `HTTP 401` — the token is wrong or revoked. Make a new one.
- `HTTP 403 Missing required scope: X` — the API key lacks the scope for that endpoint. Recreate with the right scopes via `api-key create`.

## Environment summary

| Variable | Default | Used by |
|---|---|---|
| `EXTRACTO_URL` | `http://127.0.0.1:3000` | All `/api/*` calls |
| `EXTRACTO_TOKEN` | (read from `~/.extracto/config`) | `/api/v1/*` calls |
| `EXTRACTO_PROJECT_DIR` | repo root | `compose` commands |
| `EXTRACTO_LOG_DIR` | `~/.local/state/extracto/logs` | run-step output |

## When NOT to use this skill

- For changing API provider settings or API keys — use the web UI for those (the CLI deliberately doesn't write secrets).
- For real-time job streaming — the `wait` command polls every 2s, not via SSE. For sub-second latency, hit `/api/jobs/<id>/stream` directly.
- For creating users — `extracto api-key create <email>` requires the user to already exist (signup happens through the web UI).
