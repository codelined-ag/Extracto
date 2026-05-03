# Changelog

All notable changes to this project are documented in this file. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning
follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.3.2] - 2026-05-03

### Added
- **Per-page selection for PDFs.** New page picker in the workspace shows
  every PDF page as a thumbnail with a checkbox; pick which pages to
  OCR instead of always processing the whole document. Range input
  (`1-5,7,10`), Select all / Select none, and double-click any thumbnail
  for a full-size single-page view.
- **`pageNumbers` parallel array** on `POST /api/v1/ocr/batch` and
  `POST /api/ocr` to preserve original page numbering when the caller
  pre-splits a PDF and submits a subset.
- **CLI**: `extracto ocr <file> --pages 1-5,7` extracts the requested
  pages locally via `pdftoppm` (poppler-utils) and submits the subset.
  Errors clearly if `pdftoppm` is not installed.
- **MCP**: `ocr_submit` tool gained `pages` + `pageNumbers` params.
- **PowerShell launcher (`scripts/extracto.ps1`)** gained full parity
  with the Bash CLI: `api-key`, `ocr`, `jobs`, `presets`, `kb`
  (export + test-connection), `settings`. Install now broadcasts
  `WM_SETTINGCHANGE` so new terminals pick up the PATH update without
  logout, and verifies the launcher post-install.
- **Vector-store test-connection** across all surfaces (UI button,
  `POST /api/kb/test-connection`, `POST /api/v1/kb/test-connection`,
  `extracto kb test-connection`, MCP `kb_test_connection`). Probes
  Chroma `/api/v1/collections` (with `/api/v2/...` auto-detection),
  Qdrant `/collections`, Weaviate `/v1/schema` so a 401 surfaces here
  instead of after the embedding step.
- **Chroma /api/v2 auto-detection** in the adapter. Probes
  `/api/v2/heartbeat` first, falls back to `/api/v1/heartbeat`, caches
  the resolved version. Configurable `apiVersion`, `tenant`,
  `database` on the adapter; defaults `default_tenant` /
  `default_database`.
- **Vector-store endpoint allowlist** (`VECTOR_STORE_ALLOWED_HOSTS`)
  enforced on both KB test-connection routes AND on the existing
  `/api/v1/export/kb` route. Cloud-metadata addresses
  (`169.254.169.254`, `metadata.google.internal`,
  `metadata.azure.com`) blocked unconditionally.

### Changed
- File-list filename now wraps to multiple lines instead of being
  truncated, with the full path on the title attribute.

### Fixed
- `Account` dropdown in the workspace header now shows only **Sign
  out** (Provider / Knowledge base were redundant: both live in
  Settings).

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
