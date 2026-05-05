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

### Estimate cost before running

```bash
extracto estimate ./report.pdf --model anthropic/claude-3.5-sonnet
extracto estimate ./scan.png --model mistral-ocr-latest
extracto estimate --pages 50 --model openai/gpt-4o
extracto estimate ./report.pdf --model openai/gpt-4o --post-model anthropic/claude-3.5-sonnet --post-format json
```

`extracto estimate` calls `POST /api/v1/ocr/estimate` and returns the dollar total before you commit. Page counts are auto-detected (PDFs via `pdfinfo`, images = 1 page) or you can pass `--pages N` directly. Pricing sources: OpenRouter live API, LiteLLM community mirror for OpenAI-compatible models, static table for Mistral OCR (per-page billed; Mistral has no pricing API), $0 for Ollama. Self-hosted OpenAI-compatible endpoints with no mirror entry return $0 plus a warning so you know the estimate excludes provider cost. Pass `--post-model NAME` to add a post-processing pass to the estimate.

### Translate or summarize the OCR output

```bash
extracto ocr ./report.pdf --model openai/gpt-4o --post-template translate --target-language Italian
extracto ocr ./meeting.pdf --model openai/gpt-4o --post-template summarize-3sentence
extracto ocr ./meeting.pdf --model openai/gpt-4o --post-template summarize-executive --post-model anthropic/claude-sonnet-4.6
extracto ocr ./meeting.pdf --model openai/gpt-4o --post-template extract-actions --post-format markdown
```

`--post-template` selects a server-built post-processing instruction so you don't have to write it yourself. Supported: `translate` (requires `--target-language`), `summarize-3sentence`, `summarize-executive`, `extract-actions`, or `custom` (the default; pairs with the free-form instruction in your stored settings). `--post-model` overrides the post-processing model; `--post-format` selects markdown or json output. The same fields are accepted on `POST /api/v1/ocr/batch` (`postProcessing.template`, `postProcessing.targetLanguage`) and the `ocr_submit` MCP tool.

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

### Edit a page (with version history)

```bash
extracto jobs edit-page <job-id> <page-number> --text "Cleaned-up markdown..."
extracto jobs edit-page <job-id> <page-number> --from-file path/to/page.md
extracto jobs page-history <job-id> <page-number>
```

`edit-page` replaces the markdown of one page on a `COMPLETED` job and re-stitches the job's `extractedText`. The previous text is appended to the page's edit history (max 20 entries; newest first). The job is flagged `userEdited: true`, and prior KB/S3 exports are marked stale, you'll need to re-export to update them.

### Export a job to a downloadable file

```bash
extracto jobs export <job-id> --format md                       # default
extracto jobs export <job-id> --format docx --out report.docx
extracto jobs export <job-id> --format xlsx                     # markdown tables become sheets
extracto jobs export <job-id> --format csv                      # markdown table as CSV
extracto jobs export <job-id> --format rtf
extracto jobs export <job-id> --format txt                      # plaintext, sigils stripped
extracto jobs export <job-id> --format html
extracto jobs export <job-id> --format json                     # full structured result
extracto jobs export <job-id> --format obsidian                 # vault zip ready to drop into Obsidian
```

`extracto jobs export` calls `GET /api/v1/jobs/{id}/export?format=...`. Supported formats: `md`, `json`, `txt`, `html`, `docx`, `rtf`, `csv`, `xlsx`, `obsidian`. CSV emits the first markdown table; if the document has multiple tables the file contains all of them with `# table N` separators. XLSX puts each markdown table on its own sheet (and falls back to a single text-dump sheet for prose-only documents). The `obsidian` format returns a zip with a per-job folder (date-prefixed for sortability), an index note with frontmatter, per-page notes under `pages/` for multi-page jobs, and attachments under `attachments/` when the source preview is available. Only works on `COMPLETED` jobs (returns 409 otherwise).

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

extracto jobs bulk-tag --jobs id,id,... --tags id,id,...                # union (idempotent)
extracto jobs bulk-tag --jobs id,id --tags id --mode replace            # clear-and-write
extracto jobs bulk-tag --jobs id,id --tags "" --mode replace            # destructive: strips ALL tags from those jobs
```

`jobs list` and `jobs get` include a `tags: [{id, name, color}]` array.

### Saved searches

Persist a filter set under a name and recall it later. Useful when an agent or operator runs the same History query repeatedly.

```bash
extracto searches list                                       # list saved searches
extracto searches save "Q1 invoices" --q invoice --from 2026-01-01 --to 2026-03-31 --tags tagid1
extracto searches save "Latest failures" --status FAILED --from 2026-04-01
extracto searches rename <id> "Q2 invoices"
extracto searches delete <id>
```

Saving with a name that already exists overwrites that search's filters. The list endpoint self-heals: tag ids in `filters.tagIds` that no longer exist (deleted tags) are stripped from the response so the search doesn't silently match nothing. Apply a saved search by reading its `filters` JSON and passing those flags to `extracto jobs list`.

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

- All commands emit JSON straight from the API surface, no transformation. Pipe to `jq` for filtering.
- The OCR job result includes:
  - `extractedText`: the final markdown.
  - `result`: structured JSON. `result.structured.pages[]` is the per-page array; each entry has `pageNumber`, `durationMs`, `markdown`, and (when detection succeeds) `language` (ISO 639-3, e.g. `eng`/`ita`) plus `languageName` (English name).
  - `metadata`: provider, model, timing, post-processing info, `pageResults[]` mirroring the per-page fields above, and (when first-page heuristics succeed) a `document` sub-object with `title`, `date`, `authors[]`, and `keywords[]`. May also include `documentType` `{ kind, confidence }` where `kind` is one of `invoice`, `receipt`, `contract`, `academic`, `form`, `id`, or `generic`. A page entry may include `degenerateRetry: { reason, succeeded }` when the server detected degenerate output (`char-run` / `no-whitespace` / `token-loop` / `provider-noise`) and re-OCR'd the page once without text-layer anchoring. The reason is the failure mode that triggered the retry. Retries are budgeted per job so a pathologically broken document cannot double the cost of an entire batch.

## Cloud storage integrations

Operators register an OAuth app per provider (Dropbox, Google Drive, OneDrive) at the provider's developer console, then set the client id/secret in `docker.env` and a `PUBLIC_BASE_URL` matching the URL users hit in a browser. Users connect their account from Settings; tokens are stored encrypted with an `AUTH_SECRET`-derived key.

```bash
extracto dropbox list                                       # lists the App folder root (or pass a path)
extracto dropbox list /Apps/Extracto/incoming
extracto dropbox import --path /Apps/Extracto/invoice.pdf --model mistral-ocr-latest
extracto dropbox push --job <job-id> --folder /Apps/Extracto/output --format docx
extracto dropbox disconnect
```

Import downloads the file from Dropbox, queues it for OCR, and returns the `jobId`. Push renders a COMPLETED job to the chosen format and uploads it back to the chosen folder. Same surface is exposed on `POST /api/v1/integrations/dropbox/{import,push}` and the `dropbox_*` MCP tools.

```bash
extracto gdrive list                                         # list root of My Drive
extracto gdrive list <folder-id>                             # list a folder by Drive id
extracto gdrive import --file <file-id> --model openai/gpt-4o
extracto gdrive push --job <job-id> --parent <folder-id> --format docx
extracto gdrive disconnect
```

Google Drive uses the least-privilege `drive.file` scope: the app can only see files the user picks via the connected app or files the app itself created. While the operator's OAuth project is in Google's "Testing" status, refresh tokens expire after 7 days; submit the project for Basic Verification (no security audit) to remove that limit. Same surface on `POST /api/v1/integrations/google_drive/{import,push}` and the `google_drive_*` MCP tools.

```bash
extracto onedrive list                                       # list App folder root
extracto onedrive list <item-id>                             # list a folder by item id
extracto onedrive import --file <item-id> --model openai/gpt-4o
extracto onedrive push --job <job-id> --parent <item-id> --format docx
extracto onedrive disconnect
```

OneDrive uses the least-privilege `Files.ReadWrite.AppFolder` scope plus `User.Read` and `offline_access`. The app gets its own `/Apps/Extracto/` subfolder under the user's personal OneDrive — work / school accounts are out of scope for v0.11.0 (they require admin consent and the `common` authority instead of `consumers`). Same surface on `POST /api/v1/integrations/onedrive/{import,push}` and the `onedrive_*` MCP tools.

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
