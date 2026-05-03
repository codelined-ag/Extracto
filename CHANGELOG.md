# Changelog

All notable changes to this project are documented in this file. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning
follows [SemVer](https://semver.org/).

## [Unreleased]

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
  `jobs_list`, `kb_search`).
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
- Test suite grew from 1043 to 1117 (+74). New coverage: `middleware`
  (PUBLIC_PATHS allowlist + bearer gate), `ollama-dispatch` (host
  fallback + model cache), `/api/jobs` (list + detail + control),
  `/api/auth` (login + signup + session + signout), `/api/v1/keys`,
  `/api/v1/metrics`, `/api/v1/presets`.

### Quality
- `desloppify` strict score: **82.3 / 100**. See `scorecard.png` for
  the full per-dimension breakdown.

[Unreleased]: https://github.com/codelined-ag/extracto/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/codelined-ag/extracto/releases/tag/v0.3.0
