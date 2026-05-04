# Changelog

All notable changes to this project are documented in this file. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning
follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.5.1] - 2026-05-04

### Added
- Settings → Model exposes a "Pages in parallel" numeric input (0 = auto picks the per-provider default, max 16).
- Settings → Knowledge base exposes a "Parallelism" numeric input for embedding fan-out (1..16, persisted in KB defaults).
- Queue bulk action bar gained a "Run OCR (N)" button so a multi-select runs only the chosen pending files.
- Queue gained a horizontal gallery view alongside the list view, with a list/gallery toggle in the card header.

### Fixed
- OpenSearch bulk failures now surface up to three per-item reasons (`_id` + `error.reason`) instead of just a count.

## [0.5.0] - 2026-05-04

### Added
- Concurrency control: OCR pages now run in parallel batches with per-provider sane defaults (Ollama 1, Mistral 4, OpenRouter 4, openai_compat 2). Override per-request with `pageConcurrency` (UI / API / CLI `--page-concurrency` / MCP).
- KB export embeddings can now run in parallel batches; pass `embeddingConcurrency` via the API, MCP, or CLI `--embed-concurrency`.
- KB export streams real-time progress over SSE: chunking → embedding (with done/total) → upserting → done. The UI dropdown reflects the current phase + embedding count live.
- Three new vector store adapters: Milvus (REST v2), OpenSearch (k-NN bulk), and Pinecone (per-index host).
- Settings dialog gained an API keys tab for creating, listing, and revoking bearer keys without touching the CLI.
- Header user dropdown gained a "Change password" entry backed by a new `/api/auth/change-password` route with rate-limit + session refresh.
- Sessions on other devices are invalidated after a password change via a `passwordChangedAt` claim plus a per-request DB check.
- Document preview redesigned: gallery view (one big page with prev/next + thumbnail strip and per-page selection) and list view (page-by-page rows with bulk-toggle); old text-input page-range picker removed.
- Bulk selection across queued documents with a Remove action.
- Translated placeholders on every text input (5 languages).
- Footer link points to the Extracto repo.

### Changed
- `extracto on` and `extracto upgrade` now remove any stale `--name extracto` containers from the README's Path A flow before bringing up the compose stack.
- KB export defaults to enabled; `KB_EXPORT_ENABLED=0` opts out (was opt-in).
- Empty-state document icon switched to an animated GIF; copy now sits closer to the icon.

### Fixed
- Settings Combobox items were rendered with `pointer-events: none` and `opacity-0.5` because the Tailwind `data-[disabled]:` selector matched the literal string "false". Items now select on click and scroll properly.
- Service worker bumped to `extracto-v2` and stops precaching the HTML shell so chunk-hash references stay current after redeploys.

## [0.4.0] - 2026-05-04

### Added
- Document anchoring: extracts the PDF text layer + bounding boxes server-side and injects them into the vision-model prompt as ground truth.
- Hybrid text-layer fast-path: skips the vision model entirely on PDFs with a high-confidence text layer (free, lossless, instant).
- Junk-OCR detector: the fast-path is automatically skipped when the text layer looks like noise (low alphabetic ratio or no word-shaped tokens).
- Column-aware reading order in the text-layer extractor (handles two-column papers correctly).
- Heading inference from font size (renders larger fonts as `#`, `##`, `###`).
- Document-type presets (`generic`, `academic`, `invoice`, `contract`, `form`) that sharpen the per-document prompt and request structured JSON for invoices and forms.
- `sourcePdf` field on `POST /api/v1/ocr/batch` and `POST /api/ocr` so callers can hand the server the original PDF for anchoring.
- CLI flags `--preset KIND` and `--no-text-layer` on `extracto ocr` (bash and PowerShell).
- MCP `ocr_submit` schema gained `pages`, `pageNumbers`, `sourcePdf`, `documentPreset`, and `preferTextLayer`.
- `OcrSetting` Prisma table gained `preferTextLayer` and `documentPreset` columns, auto-applied via `prisma migrate deploy` on container startup.
- `scripts/benchmark-extraction.ts` for measuring baseline vs anchored vs text-layer performance against any PDF.
- Caddyfile body cap raised to 128 MB to accommodate `sourcePdf` payloads.

### Changed
- The default per-page prompt now adapts to the configured document preset.
- CLI and MCP submissions now inherit the user's saved `documentPreset` and `preferTextLayer` settings unless overridden per-call.
- `next.config.ts` declares `pdfjs-dist` as a server-external package for clean Next.js standalone tracing.

### Caveats
- RTL languages (Arabic, Hebrew) are detected for sort order only; intra-block character order in the text-layer extractor is not yet reversed.
- The text-layer fast-path can fragment dense multi-column pages where pdfjs emits each word as a separate span. The anchored vision-model path is unaffected. Disable the fast-path per-job with `--no-text-layer` (CLI), `preferTextLayer: false` (settings) when this matters.

## [0.3.2] - 2026-05-03

### Added
- Per-page PDF selection: pick which pages to OCR from the UI, REST API, CLI (`--pages 1-5,7`), or MCP (`pages` / `pageNumbers`).
- Vector-store test connection: probe Chroma / Qdrant / Weaviate before exporting, available in the UI, REST API, CLI, and MCP.
- Chroma `/api/v2` auto-detection in the adapter (v1 fallback preserved; configurable tenant + database).
- PowerShell launcher parity with the bash CLI: `api-key`, `ocr`, `jobs`, `presets`, `kb`, `settings`.
- `VECTOR_STORE_ALLOWED_HOSTS` env var, with cloud-metadata addresses blocked unconditionally.

### Changed
- File-list filenames now wrap instead of being truncated mid-word.
- PowerShell `install` broadcasts `WM_SETTINGCHANGE` so `extracto` resolves in new terminals immediately.

### Fixed
- Account dropdown shows only `Sign out` (Provider and Knowledge base already live in Settings).

## [0.3.1] - 2026-05-03

### Changed
- `extracto on` now **pulls** the published image from
  `ghcr.io/codelined-ag/extracto` by default instead of building
  locally. Source builds still available via `extracto on --build`.
  Mirrors `docker-compose.yml` which gained an `image:` entry pointing
  at the GHCR tag (controllable via `EXTRACTO_TAG`).
- Renamed the Windows launcher's `extracto update` → `extracto upgrade`
  for parity with the Bash launcher; old `update` command kept as an
  alias.

### Added
- `extracto upgrade` command on both launchers — pulls the latest
  image from ghcr.io and recreates the container in one step.
- README Quickstart now documents three paths (single `docker run`,
  installer for Linux/macOS, installer for Windows) instead of just
  one.

### Fixed
- `Dockerfile` no longer tries to `COPY --from=builder /app/db ./db`.
  The `db/` dir is gitignored / dockerignored, so the COPY blew up
  multi-arch GHCR builds with `failed to compute cache key:
  "/app/db": not found`. The runtime DB lives at `/app/data/`
  (a mounted volume), not `/app/db/`, so this had no behavioral effect.

## [0.3.0] - 2026-05-03

First public release. Bundles the prior pre-release work plus a major
hardening + restructuring pass.

### Added
- Pre-built multi-arch (amd64 + arm64) Docker image at
  `ghcr.io/codelined-ag/extracto`. Pull instead of build.
- GitHub Actions CI (`.github/workflows/ci.yml`) running lint,
  typecheck, tests, and production build on every PR + push to main.
- GitHub Actions release workflow (`.github/workflows/release.yml`)
  that publishes the multi-arch image and a GitHub release on tag.
- MCP (Model Context Protocol) server at `scripts/mcp-server.ts` that
  exposes the v1 OCR API as agent tools (`ocr_submit`, `ocr_get`,
  `jobs_list`, `job_stop`, `kb_search`, `kb_export`, `presets_list`).
  Documented config snippets for Claude Desktop, Cursor, Codex,
  OpenClaw, and Hermes Agent.
- Hierarchical chunking strategy for KB export (markdown-heading
  aware; each chunk inherits its `headingPath` breadcrumb and
  `headingLevel` in metadata). Configurable `maxHeadingDepth`.
- Semantic chunking strategy for KB export (embedding-similarity
  boundary detection; embeds every sentence and splits where
  consecutive cosine distance exceeds the configured
  `breakpointPercentile`, default 95). Surfaces in UI, CLI, MCP,
  OpenAPI, and the persisted KB defaults.
- On-brand favicon set: italic Fraunces "E." (the wordmark cropped
  to its first letter and signature italic period) on the warm-orange
  chip. SVG sources, multi-size `favicon.ico`, 192/512 PNGs,
  180×180 apple-touch-icon, PWA maskable.
- Hand-written `openapi.yaml` covering the full `/api/v1/*` surface,
  importable into Bruno, Postman, Insomnia, etc.
- `examples/` directory with runnable integration recipes: Python
  OpenAI-SDK client, TypeScript LangChain tool, n8n workflow, Slack
  webhook handler.
- Bulk-delete + bulk-export-as-zip in the history dialog.
- Drag-and-drop folder upload (walks `webkitGetAsEntry` and submits
  every OCR-able file inside).
- `SECURITY.md` with coordinated-disclosure contact + supported
  versions.
- Curated screenshots embedded in the README.
- MIT `LICENSE`, `CONTRIBUTING.md`, issue + PR templates,
  `.dockerignore`.
- `ALLOW_SIGNUP` env flag (default `1`) to gate `POST /api/auth/signup`.
- `WEBHOOK_ALLOWED_HOSTS` env allowlist; outbound webhook deliveries
  reject private, loopback, and link-local hosts unconditionally.
- User menu in the header with quick links to provider, knowledge
  base, and sign out.
- Browser-language detection on first visit (falls back to English
  when no localStorage entry exists).
- `viewport.themeColor` sets per-scheme browser chrome colors.

### Changed
- pipeline.ts split into `model-catalog.ts`, `job-input-helpers.ts`,
  and `job-submit.ts` (orchestrator file dropped from ~810 to ~340
  LOC). Tests + production callers import from leaf modules.
- Endpoint normalizer surfaces consolidated to `provider-normalization.ts`
  as the single canonical surface; `*ApiBase` wrappers now delegate.
- `ProviderKind`, `ApiProviderSettings`, `normalizeProvider`
  consolidated to `@/lib/api-types` (no more dual-import paths).
- `db.ts` wraps `PrismaClient` in a Proxy with a memoized factory so
  `DATABASE_URL` is read lazily — matches the lazy-getter discipline.
- Body font is Manrope; mono is JetBrains Mono; display is Fraunces.
- Default UI language is now English (was Italian) with auto-detect.
- Minimum signup password raised from 8 to 12 characters.
- `KB_EXPORT_ENABLED` defaults to `0` (opt-in for self-hosters).
- `parseStatusFilter` is a discriminated union (no more tristate).
- `buildJsonResult` takes an options bag instead of 7 positional args.
- `runOllamaPostProcessing.outputFormat` is required (matches siblings).

### Fixed
- **Correctness**: history dialog `useEffect` depended on the entire
  `history` object literal (re-created on every parent render) so
  `loadDetail` was firing on a tight loop, starving the job-list pane
  of paint cycles. Tightened the deps to the specific stable refs
  the effect actually reads.
- **Security**: `/api/kb/pull-model`, `/api/kb/embedding-models`, and
  `/api/v1/export/kb` now wrap user-supplied endpoints in
  `enforceProviderEndpointPolicy` — closes an SSRF-style bypass on
  the KB feature.
- **Security**: `/api/kb/embedding-models` scope tightened from
  `settings:read` to `settings:write` to match its mutation semantics.
- **Correctness**: `endpoint-policy` throws `ApiRouteError(400)`
  instead of bare `Error`, so malformed endpoints surface as 400 not
  500.
- **Correctness**: `runOllamaPostProcessing` was passing `signal`
  inside the fetch init bag where `fetchWithTimeout` overwrote it —
  `OcrStopRequestedError` discrimination was broken on the
  post-processing path. Now passed as the dedicated argument.
- **Correctness**: `runMistralPostProcessing` and
  `runCompatPostProcessing` now accept and honor an `AbortSignal`,
  matching their OCR siblings.
- **Correctness**: `pipeline-post-processing-stage` registers its own
  `AbortController` with `job-control` so the stop button actually
  aborts in-flight post-processing (previously stop only worked
  during the per-page OCR phase).
- `docker-entrypoint.sh` auto-baselines on Prisma `P3005` so users
  upgrading from a `db push` volume don't crash-loop.
- `extracto api-key` CLI works inside the runtime container — `src/lib`
  + `tsconfig.json` are now copied into the image, and the wrapper
  reads `AUTH_SECRET` from the disk file when `compose exec` doesn't
  inherit the entrypoint's env.
- `EmbeddingError` detail string translated from Italian to English.
- `history-dialog` dropped a dead `(j.status as string) === "PAUSED"`
  comparison (status union has no PAUSED variant).
- File-count pluralization in the sidebar now passes all five languages.
- Empty preview "Click Run OCR" copy translated to it/en/fr/es/de.
- Wordmark no longer clips the italic descender or the period.
- v1 mutation handlers now uniformly `throw ApiRouteError` instead of
  mixing with `return NextResponse.json({error}, {status})`.

### Tests
- Test suite grew to 1189 (+146 over the prior pre-release baseline).
  New coverage: `middleware` (PUBLIC_PATHS allowlist + bearer gate),
  `ollama-dispatch` (host fallback + model cache), `/api/jobs`,
  `/api/auth`, `/api/v1/keys`, `/api/v1/metrics`, `/api/v1/presets`,
  `/api/v1/webhooks`, `/api/v1/export/kb`, `resumeOcrJob` branches,
  `chunkHierarchical` (heading semantics + skipped levels + depth
  folding), `chunkSemantic` (percentile boundaries + dimension
  validation + degenerate inputs).

[Unreleased]: https://github.com/codelined-ag/extracto/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/codelined-ag/extracto/releases/tag/v0.3.0
