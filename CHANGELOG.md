# Changelog

All notable changes to this project are documented in this file. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning
follows [SemVer](https://semver.org/).

## [Unreleased]

## [1.4.1] - 2026-05-08

Closes the v1.4.0 carry-over block.

- Heartbeat metadata write is gated to status=PROCESSING so a late tick cannot overwrite COMPLETED.
- Each page run checks the stop flag before starting, so concurrent batches honor stop sooner.
- markOcrJobRunning invalidates the stop-request cache.
- JSON-in-text extractor uses a state-machine scanner so escaped quotes don't truncate markdown.
- Document classifier falls back to the longest non-empty page when page 1 is missing.
- PATCH /api/v1/keys/{id} edits scope, rate-limit, or name in place; mirrored in MCP and CLI.
- 2FA setup with force:true now requires the current account password.
- Adds PII detectors for street addresses, person names, passport numbers, and driver's-license numbers.
- Phone validator rejects +prefix matches whose country code is not a real ITU code.
- DOB regex picks up the DD.MM.YYYY (German/EU) variant.
- Vector store adapters share a fetchWithRetry with Retry-After honoring, exponential backoff, and a 3-attempt cap.
- Cloud-export window.prompt() pair becomes a controlled Dialog with folder input and format select.
- Integrations panel renders one primary CTA per provider via a state machine.
- Credential source renders as a Badge instead of muted prose.
- ENV-set OAuth credentials hide the per-user form by default; meatball menu has an explicit Override.
- Connect path detects 503/available:false and opens the OAuth credentials form inline.
- Cloud Import dialog adds an inline Connect button when the active tab's provider is not connected.
- Setup wizard's final step exposes optional Connect Dropbox / Drive / OneDrive shortcuts.
- Boot-time sweep re-encrypts legacy plaintext webhook signing secrets and S3 secretAccessKey blobs at rest.
- SQLite FTS5 virtual table backs OcrJob full-text search, with AFTER UPDATE gated on extractedText/fileName so heartbeats don't rebuild the index.
- Search route prefers MATCH over instr() when FTS is available and falls back when it is not.

## [1.4.0] - 2026-05-08

Closes the v1.3.4 hardening audit (High + Medium + Low blocks) in one cut.

- PII redaction now runs at every per-page DB write site, not only at finalize.
- Push-subscribe blocks SSRF via a default allowlist (FCM, Mozilla, Apple, Microsoft) overridable through PUSH_ALLOWED_HOSTS.
- Webhook signing secret and S3 secretAccessKey are encrypted at rest with AES-GCM keyed off AUTH_SECRET.
- Watcher PATCH/DELETE switch to updateMany/deleteMany scoped on (id, userId) so the WHERE clause enforces ownership atomically.
- OAuth refresh per (userId, provider) is serialized through an in-process mutex.
- OAuth refresh fetches now have a 15s timeout so a hung upstream cannot wedge concurrent callers.
- Render errors fall through to app/error.tsx and app/global-error.tsx instead of blanking the workspace.
- Login and signup run a dummy scrypt on the unknown-email and collision branches to blunt the user-enum side channel.
- Email change bumps passwordChangedAt so old session tokens fail the pv check.
- Tokens without a pv claim are no longer grandfathered.
- Boot-time and 5-minute sweeps flip orphaned PROCESSING jobs older than OCR_ORPHAN_JOB_STALE_MS to FAILED.
- Webhook delivery body is nulled when status flips to exhausted, not only on delivered.
- POST /api/v1/webhooks/{id}/rotate-secret rotates the signing secret in place.
- POST /api/v1/keys/{id}/rotate rotates an API key in place.
- Webhook test endpoint is per-user rate-limited.
- MCP gains presets_create, presets_delete, keys_list/create/delete/rotate, metrics_get, webhooks_rotate_secret.
- ocr_submit settings schema accepts piiRedaction.
- ocr_comparison_get description corrected to all-pairs.
- SKILL.md operator-env section rewritten with the full set of allowlist, lifecycle, auth, search, KB, push, and SMTP flags.
- Drag-and-drop applies the same accept filter as the file picker and toasts on rejected items.
- Settings PUT debounce now uses an AbortController so rapid changes don't race last-write-wins.
- Post-processing model effect preserves a freshly typed selection.
- OAuth state cookie is namespaced per provider.
- OAuth state callback compare uses timingSafeEqual.
- 2FA challenge token carries a single-use jti consumed for its 5m TTL on success.
- e2e/key PUT enforces the body cap on the raw text, not only Content-Length.
- Mistral provider retries the next endpoint candidate on network errors.
- Mistral surfaces empty-allowlist failures with a clear message.
- parsePreviewImageData rejects mime types outside image/* and application/pdf.
- S3 module-import error expires after five minutes so a transient failure does not disable the result store.
- Resumed-page text and persisted pageRecord text are capped at safe limits.
- PWA service worker calls registration.update() on visibility change.
- Camera-capture toast deduplicates by errorMessage.
- Auth page renders a small loading state instead of flashing empty.
- removeFile computes remaining inside the setFiles callback so selection updates don't read stale state.
- Compare-polling setTimeout handle is cleared on unmount.
- OCR, webhook-test, and S3 rate-limit IP keys can be salted via OCR_RATE_LIMIT_IP_SALT.

## [1.3.3] - 2026-05-06

Third hardening pass after a 5-agent gap audit caught second-order issues in v1.3.2 and untouched feature areas.

- TOTP secrets now go through AES-256-GCM at rest with an AUTH_SECRET-derived domain key. Existing plaintext secrets auto-upgrade on first verify. The same envelope encrypts provider API keys in the on-disk settings file so a backup snapshot does not leak OpenAI/OpenRouter/Mistral keys.
- Recovery-code consume races are closed by an updateMany guard on the JSON column. Two concurrent challenge POSTs with the same code can no longer both succeed.
- Inline page edit PATCH uses updateMany with the prior editedAt as a precondition, so a lost-update across two tabs surfaces as 409 instead of silently overwriting.
- Email-change PATCH no longer returns the manual confirmation URL when SMTP is unconfigured. Operators see the link in the server log; users see instructions to recover it.
- E2E key PUT enforces a 16KB cap on Content-Length and the parsed PEM string.
- WebhookDelivery prune flips pending rows older than 2 × retention to exhausted with body cleared so a stuck row cannot pin job-result megabytes.
- Settings cache is now LRU-capped at 500 entries.
- Folder picker pushes Dropbox entry.path on navigation (was sending the entry id, which 404'd) and Google Drive folder ids are validated against /^[A-Za-z0-9_-]{10,}$|^root$/ before interpolation into the search query.
- OneDrive watchers created before v1.3.2 with folderPath="root" now resolve correctly to AppFolder root.
- Dropbox longpoll workers track folderPath and recreate when the user edits the source. pollSource is fire-and-forget so a stuck OCR submission does not pin the worker. Per-user cap of 25 workers.
- S3 watcher's per-user in-flight counter no longer leaks when the userId lookup in finally throws.
- SKILL.md has a new operator-only env section for CLOUD_PUSH_ENABLED, WEBHOOK_DELIVERY_RETENTION_DAYS, RETAIN_JOBS_DAYS, LOCAL_WATCH_ROOT, WEBHOOK_ALLOWED_HOSTS, OLLAMA_HOST_FALLBACKS, TRUSTED_PROXY_HEADERS. Compare-diff section is rewritten for the all-pairs contract. Watcher ingestedCount is now in both the SKILL field list and the MCP watchers_list description.

## [1.3.2] - 2026-05-06

Second hardening pass closing the v1.3.1 nice-to-haves.

- E2E key registration refuses non-RSA SPKI keys and any RSA modulus under 2048 bits, with a fallback path for runtimes that hide modulusLength on KeyObject. Error messages are scrubbed so OpenSSL strings do not leak.
- WebhookDelivery rows in delivered or exhausted state prune every six hours after WEBHOOK_DELIVERY_RETENTION_DAYS (defaults to 30). Pending rows are never touched so the retry queue stays intact.
- Watcher cards show ingested count and last-checked timestamp so a healthy watcher visibly produces work even when lastError is null.
- Compare picker hides models from non-configured providers; the diff is now precomputed for every i<j pair and any model header can be clicked to make it the baseline. Reverse-direction lookups flip insert/delete and inserted/deleted counts.
- New folder picker dialog browses Dropbox / Google Drive / OneDrive folders with breadcrumb navigation. OneDrive AppFolder root resolves correctly when the dispatch sees an empty path.
- Dropbox longpoll worker (CLOUD_PUSH_ENABLED=1) cuts change-latency to seconds. Drive and OneDrive subscriptions defer until a deployment story for publicly reachable callback URLs is ready.

## [1.3.1] - 2026-05-06

Hardening pass over the v1.3.0 surface after a 5-agent gap audit.

- Wire up the previously REST-only v1.0 features that never got browser UI: form-fields and equations panels on completed jobs, RSA SPKI public-key registration in Account → End-to-end encryption, webhooks list / create / pause / delete / delivery history in Account → Webhooks, and the post-processing template picker (`custom`, `translate`, `summarize-3sentence`, `summarize-executive`, `extract-actions`) plus a target-language input.
- Post-processing templates other than custom now actually submit; the run-readiness gate respected only the custom-instruction field. Translate without a target language surfaces a dedicated toast.
- Webhook deliveries retry with exponential backoff (1m, 5m, 30m, 2h, 12h) and auto-disable after 20 consecutive failures.
- Local and DB-backed watchers fire watcher.ingested on every successful submission; previously only the S3 watcher emitted it.
- Disconnecting Dropbox or Google Drive now revokes the OAuth token at the provider before deleting the local row.
- DB-backed local watcher skips files younger than 5s so partial copies cannot be ingested mid-write.
- Watcher creation rejects cloud providers that have no integration connection.
- PII detection: phone regex tightened, ISO and DD/MM/YYYY date formats added with the year capped at 2019 to avoid catching transaction dates, and a "PII redacted (N)" badge appears on results when the audit reports applied.
- Equation extraction: display offsets anchored to source text, inline matches require a LaTeX hint or letter-with-operator, escaped dollar pairs are ignored.
- Form-fields endpoint falls back to invoice / receipt / contract / id / academic wrappers and to a flat fields object so non-form presets surface their data.
- Job extras panel retries up to three times for the brief race between job COMPLETED and metadata being readable.
- Compare polling backs off to a 30s ceiling and aborts after 12 minutes.
- Recommendations dialog flags low-confidence picks (fewer than 10 runs).
- Webhook PATCH accepts url and events; new POST /api/v1/webhooks/{id}/test fires a synthetic signed delivery.
- Webhooks parity: list, create, update, delete, test, deliveries on MCP and CLI; full SKILL section.
- Cloud disconnect parity: integration_disconnect on MCP, the v1 DELETE routes are now bearer-auth.
- E2E section copy clarifies that only /api/v1/e2e/encrypt responses are sealed; cloud Connect button walks users into the OAuth-app form when no credentials exist; OneDrive watcher input warns about the AppFolder scope.

## [1.3.0] - 2026-05-05

### Added
- PII redaction toggle in the workspace Advanced Options panel; the existing pipeline option finally has a UI control.
- A/B model comparison dialog: pick 2-4 models, run them on the selected file, and see side-by-side outputs with word-level diff against the baseline.
- Recommendations dialog surfaces the best-performing model per document type pulled from your own job history; entry button lives next to the OCR model picker.



### Added
- Advanced Options panel state, post-processing toggle, instructions, model, and output format now persist across refresh.
- Post-processing progress card with elapsed seconds, model, and output format renders in the workspace while the stage is running. The progress bar advances on a 1.5 s heartbeat instead of sitting at 70%.

### Fixed
- Heartbeat updates no longer race the success snapshot; cancellation gates write attempts before and after the DB call and a self-rescheduling timer prevents pile-ups under DB latency.
- Hydration mismatch on the Advanced Options collapsible: SSR renders closed; localStorage rehydrates after first paint.



### Added
- Inline hover tooltips for every setting in the OCR, Knowledge base, and Storage tabs (provider, endpoint, API key, model, parallelism, embedding fields, chunking strategy, vector-store kind, S3 fields).
- Integrations docs site: `/integrations/overview`, `/integrations/oauth-credentials`, `/integrations/watched-folders` on extracto.help.

## [1.2.0] - 2026-05-05

### Added
- Per-user OAuth credentials: paste your own Dropbox / Google / Microsoft client_id+secret in Settings → Integrations when the operator hasn't preconfigured them. Stored encrypted with AUTH_SECRET.
- Local watched folder: a fourth watcher provider that sweeps a sandboxed sub-folder under LOCAL_WATCH_ROOT/<userId>/ and pushes any new file (pdf, png, jpg, webp; up to 64 MiB) into the OCR queue.
- New REST surface for OAuth credentials: GET / PUT / DELETE /api/v1/integrations/{provider}/oauth-app, mirrored on /api/integrations.
- New MCP tools: oauth_app_status, oauth_app_set, oauth_app_clear.
- New CLI: extracto integrations oauth-app {get,set,clear}.

### Changed
- Connect buttons no longer dead-end when the server has no OAuth credentials: each provider card now exposes an inline OAuth-app form.

## [1.1.0] - 2026-05-05

### Added
- Settings → Integrations tab to connect, disconnect, and manage Dropbox / Google Drive / OneDrive accounts.
- Import from cloud panel that browses any connected provider and queues the picked file for OCR.
- Send to Dropbox / Google Drive / OneDrive items in the per-job Actions menu, with the same Configure-toast pattern as KB and S3.
- Watched cloud folders: Extracto sweeps a chosen folder per provider on a configurable interval and auto-submits new files for OCR. Configure from the Settings UI, REST, MCP, or CLI.
- New REST surface: /api/integrations/{provider}/{list,push,import} and /api/integrations/watchers CRUD on session cookies, mirrored on /api/v1/integrations/watchers for bearer keys.
- New MCP tools: integrations_status, watchers_list, watchers_create, watchers_update, watchers_delete.
- New CLI: extracto integrations list, extracto integrations watchers {list,add,delete,pause,resume}.

## [1.0.1] - 2026-05-05

### Added
- ZIP export: GET /api/v1/jobs/{id}/export?format=zip returns a flat archive with index.md, pages/page-NNN.md per page, and all-pages.md; mirrored on MCP, CLI, and the workspace download menu.

### Changed
- Workspace upload area: Take-a-photo is centered behind an Or divider.
- Run-OCR buttons relabelled to Run.
- Result actions menu shows just the 3-dot icon with no Actions text.
- KB and S3 export errors prompt with a Configure toast that opens the right Settings tab.

## [1.0.0] - 2026-05-05

### Added
- Multi-model comparison: POST /api/v1/ocr/compare fans out one input to 2 to 4 models, GET returns each model's output plus a server-computed word-level diff against the baseline; available on REST, MCP, and CLI.
- Model recommendations from your own history: GET /api/v1/recommendations groups recent jobs by document type and ranks models by success rate, processingMs as the tiebreaker; available on REST, MCP, and CLI.
- PII auto-redaction with audit trail: POST /api/v1/pii/redact masks emails, phones, Luhn-valid cards, IBANs, IPs, URLs, dates of birth, and SSNs in arbitrary text; OCR jobs can opt in via settings.piiRedaction and the audit (kinds + offsets, no values) lives on metadata.piiAudit.
- Form field extraction: GET /api/v1/jobs/{id}/form-fields surfaces a flat fieldName-to-value map from form-shaped jobs (best results with documentPreset=form); available on REST, MCP, and CLI.
- Equation / LaTeX extraction: GET /api/v1/jobs/{id}/equations parses the OCR markdown for `$..$` and `$$..$$` blocks, ignoring code spans, and returns each match with its char offsets; best results with documentPreset=academic; available on REST, MCP, and CLI.
- E2E encryption scaffold: register an RSA SPKI public key via PUT /api/v1/e2e/key, then POST /api/v1/e2e/encrypt seals text with AES-256-GCM + RSA-OAEP-SHA256; the server never sees the plaintext after encrypt returns. Pipeline auto-encryption of OCR results is scaffolded but disabled by default; key generation, escrow, and rotation are user-owned.

## [0.11.0] - 2026-05-05

### Added
- Pre-run cost estimator on REST, MCP, CLI, and the workspace badge, pulling live per-token pricing from OpenRouter and the LiteLLM mirror, the static per-page rate from Mistral OCR, and $0 with a heads-up for local Ollama and self-hosted endpoints with no mirror entry.
- Job export to DOCX, RTF, CSV, XLSX, plus existing md/json/txt/html via GET /api/v1/jobs/{id}/export, mirrored on MCP and CLI; markdown tables become CSV rows or per-sheet XLSX automatically.
- Obsidian vault export: zip with date-prefixed folder, frontmatter-rich index note, per-page notes for multi-page jobs, and attachments folder, ready to drop into a vault.
- Post-processing template for translation: pick a target language and the server builds the right instruction; available on REST, MCP, and CLI.
- Post-processing templates for summarization: 3-sentence, executive, and extract-actions, each with a server-built instruction; available on REST, MCP, and CLI.
- Dropbox bidirectional integration: per-user OAuth (PKCE), encrypted token store, list folder, import a file straight into the OCR queue, and push results back into a chosen path; available on REST, MCP, and CLI.
- Google Drive bidirectional integration: per-user OAuth (PKCE) on the least-privilege `drive.file` scope, list folder, import a Drive file into the OCR queue, push results back to a chosen folder; available on REST, MCP, and CLI.
- OneDrive bidirectional integration: per-user OAuth (PKCE) on the least-privilege `Files.ReadWrite.AppFolder` scope, list folder, import a OneDrive item into the OCR queue, push results back to a chosen folder; available on REST, MCP, and CLI.

## [0.10.0] - 2026-05-05

### Added
- Two-factor authentication on accounts with TOTP enrollment, recovery codes, and a sign-in challenge step.
- Self-serve email change with a confirmation link that the new mailbox has to click.
- Forgot-password flow over SMTP with a one-shot signed reset link.
- In-app camera capture in the workspace, with a fallback to the platform file picker when getUserMedia is unavailable.
- Auto-contrast and shadow flattening pass on captured frames, toggleable in the preview.
- Capture modes for documents, receipts, and whiteboards, each with its own enhance preset.
- Multi-shot batch capture with a thumbnail tray, per-shot remove, and a single submit at the end.
- Offline queue that stops short of the API while disconnected and replays every queued item the moment the browser reconnects.
- Print scanning sidekick that finds the page corners in the live preview and warps the captured frame into a top-down rectangle, opt-in.

### Changed
- The OCR model picker no longer offers embedding-only models from Ollama, OpenRouter, or OpenAI-compatible providers.

### Fixed
- Concurrent OCR runs cannot overlap when the browser regains connectivity mid-batch.
- Repeated taps on Use these photos in the camera dialog no longer enqueue duplicate files.
- The email confirmation endpoint enforces the same per-IP rate limit the password reset endpoint already had.
- Token lookups for password reset and email change use an indexed match instead of scanning every user with a pending token.

## [0.9.1] - 2026-05-05

### Fixed
- KB export now rewrites localhost-flavored embedding and vector-store URLs to a docker-gateway-reachable host so naive defaults work out of the box from inside the bridged container.
- OpenSearch adapter normalizes collection names to the lowercase shape it requires; mixed-case or punctuated names no longer crash export.
- Milvus adapter sends the `max_length` schema param so collection creation stops failing with a cryptic `strconv.ParseInt` error on Milvus 2.4.
- The KB test-connection route accepts `typesense`; the MCP `kb_test_connection` tool widened to all seven supported store kinds.
- The `extracto kb export` CLI no longer crashes on a trailing-newline parsing bug when optional flags are omitted.

## [0.9.0] - 2026-05-05

### Added
- Per-page language detection surfaces ISO 639-3 codes and English names in metadata and the History detail bar.
- First-page heuristics auto-extract title, date, authors, and keywords into `metadata.document`.
- Document-type classifier identifies invoice, receipt, contract, academic, form, ID, or generic on the first page.
- Auto re-OCR retries pages with degenerate output (long char runs, no-whitespace blocks, dominant token loops, provider artifacts) once without anchoring; budgeted per job.
- Inline page editor with version history at PATCH /api/v1/jobs/:id/pages/:n; the History dialog gains a Pages tab.
- Page-pip bar above the Markdown view jumps to the matching tile in the Pages tab with a flash highlight.

### Fixed
- Hydration and a11y errors in the workspace shell: footer no longer wraps an icon `div` inside a `p`, theme toggle uses the standard mounted gate, and the History dialog now declares `DialogTitle` and `DialogDescription`.

## [0.8.0] - 2026-05-04

### Added
- Tags for OCR jobs, with create, rename, recolor, delete, and per-job apply via REST, MCP, CLI, and the History dialog.
- Smart History filters: free-text file-name search, model substring, date range, and tag filter, all backend-driven.
- Bulk-tag action on the History selection toolbar that applies a tag set to up to 200 jobs at once.
- Saved History searches: persist a filter set under a name and recall it later via REST, MCP, CLI, or the dialog.

### Changed
- The list endpoint for saved searches strips deleted tag ids from returned filters so saved searches self-heal as tags churn.

## [0.7.0] - 2026-05-04

### Added
- First-run guided tour anchored to upload, queue, page picker, Settings, Account, and History; restartable from the Account dialog.
- Setup wizard that runs once on the very first sign-in to pick provider, paste an API key, and hand off to the tour.
- OpenAPI 3.1 spec served at `/api/v1/openapi.yaml` and a Scalar API reference at `/api/v1/docs`, both public.
- `scripts/quickstart.sh` for a single-`docker run` install path that finishes inside the healthcheck window.

### Changed
- The remaining English-only user strings (model-discovery toast, embedding hint, push notification errors) are now translated into all five languages.
- README documents the new fast-path install alongside the existing compose-based installer.

## [0.6.0] - 2026-05-04

### Added
- Account dialog for personal preferences (language, API keys, push, usage), reachable from the user menu.
- Per-page OCR progress so the UI reflects work as each page completes.
- Three Prisma migrations to formalize schema changes that previously rode on `db push`.

### Changed
- Settings dialog regrouped into 4 tabs with single-open collapsible sections and sticky save buttons.
- Markdown results render with real typographic hierarchy in workspace and history.
- OCR prompt asks for explicit Markdown structure so output has headings, paragraphs, lists, tables.
- Friendly section names with one-line descriptions across Settings and Account.

### Security
- Hardened auth, rate-limit, and request-security paths with broader test coverage.
- Tightened operator defaults in `docker.env`, Dockerfile, and the install script.
- Updated security contact to supporto@codelined.com.

## [0.5.5] - 2026-05-04

### Added
- Queue + in-progress OCR state now persist across page refreshes via IndexedDB; the queue is rehydrated on load and active jobs reconcile against the server.
- Watched S3 sources: per-user CRUD UI under Settings, background poller dedupes by `(sourceId, key)` with auto-pause after 5 consecutive list failures.
- Job templates: save and reuse {provider, model, preset, language, customPrompt, postProcessing, autoExports} from a Settings tab.
- Side-by-side OCR comparison: `POST /api/ocr/compare` spawns 2-4 parallel jobs sharing a `comparisonId`, returns 207 partial-success on per-model failures, capped at 3 concurrent comparisons per user.
- Page-level corrections: `PATCH /api/jobs/:id/pages/:n` lets you fix one page's text and re-stitches `extractedText`; flags `metadata.staleExports = true` so you know to re-export.
- Per-user storage/usage pane in Settings with job and resource counts.
- PWA push notifications for completed/failed jobs (VAPID auto-generated, Settings opt-in, service worker handles `push` + `notificationclick`).
- Per-job retry: transient provider errors (429, 5xx, timeouts) auto-retry with exponential backoff up to a per-provider cap (Mistral 2, OpenRouter 3, others 5) and a 120s wall-clock budget.
- Drag-to-reorder queue priority: `PATCH /api/jobs/:id` accepts `{ priority }`.
- Webhooks: new `WebhookDelivery` audit log, `GET /api/v1/webhooks/:id/deliveries`, new event `watcher.ingested`, `dispatchUserWebhooks` for non-job events.
- New Prisma models: `OcrJobTemplate`, `WatchedS3Source`, `WatchedS3Object`, `PushSubscription`, `WebhookDelivery`.

### Security
- `PushSubscription` is globally unique by endpoint; `POST /api/push/subscribe` evicts any prior owner of the endpoint to prevent cross-user device hijack via leaked endpoints.
- `withProviderRetry` enforces a hard per-page wall-clock budget and a per-provider attempt cap to prevent stuck retry loops from holding worker slots.
- `S3 watcher` ingest takes the dedup row as a lock before downloading, eliminating the race window where a concurrent sweep could submit the same key twice; reverts the placeholder row on download or submit failure.
- VAPID key generation is now serialized via an in-flight promise; key file `chmod 0o600` is enforced explicitly even when the file exists.
- Service worker `notificationclick` only opens same-origin paths starting with `/`.
- Push failure-notification body no longer includes raw provider error text.

### Changed
- Webhooks `SUPPORTED_EVENTS` trimmed to the four events that actually fire (`job.created`, `job.completed`, `job.failed`, `watcher.ingested`); the rest were dead-letter and were removed.
- Settings now expose an `autoRetryMaxAttempts` field (1-8) for per-page transient retries.

## [0.5.4] - 2026-05-04

### Added
- S3 export accepts any S3-compatible endpoint by default (MinIO, Garage, Ceph RGW, SeaweedFS, on-prem appliances, etc.) instead of the prior named-allowlist.
- `S3_ALLOW_LOOPBACK=1` opts in all loopback/RFC1918 hosts (e.g. local MinIO sidecar); `S3_ALLOWED_HOSTS=foo.internal` allows specific private hosts without flipping the global flag.
- All six S3 routes now rate-limit per user (60/min for read, 12/min for write).
- Stop-requested jobs that have not yet reached a checkpoint now show as "Stopped" immediately in History instead of staying "Running" until the orchestrator catches up.
- Endpoint-policy regression tests covering AWS S3, R2, Backblaze, MinIO, Garage, IMDS, RFC1918, ULA-IPv6, link-local, and credential-in-URL inputs.

### Security
- `enforceS3EndpointPolicy` now blocks RFC1918, loopback, link-local IPv6, ULA-IPv6, CGNAT, AWS/GCP/Azure/Equinix metadata services, and IPv4-mapped IMDS — closing the SSRF gadget where an authenticated user could weaponize the AWS SDK against the Extracto host's localhost services.
- `enforceS3EndpointPolicy` is now invoked at use-time (in `buildUserS3Client`), not just at save-time, so tightening the env policy applies to previously-saved configs.
- `/api/s3/download` and `/api/v1/s3/download` now stream the response body (HEAD-checked size first) instead of buffering up to 200 MB into Node memory per request.
- Download routes reject keys outside the user's configured prefix and reject keys containing `..` segments or control characters.
- Bucket / region / prefix / keyPrefix inputs are validated against AWS naming rules before any SDK call.
- Browser-internal S3 routes use the `s3:read` / `s3:write` scopes for consistency with `/api/v1/*` (was `ocr:read`).
- Installer one-liner pins to a release tag by default (`v0.5.4`), uses `--proto '=https' --tlsv1.2` in the README curl, validates `EXTRACTO_REPO_URL` is HTTPS, prints a Ctrl-C window before any network call, and clones into a `.partial.$$` staging dir to avoid leaving half-populated checkouts on failure.
- README documents that the installer chains vendor scripts (`get.docker.com`, `ollama.com/install.sh`) as root and exposes `EXTRACTO_INSTALL_DOCKER=0` / `EXTRACTO_INSTALL_OLLAMA=0` opt-outs.

## [0.5.3] - 2026-05-04

### Added
- One-liner installer hosted at `scripts/install.sh` (and `install.ps1` for Windows), promoted as the README primary Quickstart.
- S3 export: per-user bucket configuration in Settings tab, "Send to S3" item in the result preview menu, real-time SSE upload progress, `POST /api/s3/export` (browser) and `POST /api/v1/export/s3` (bearer, scope `s3:write`).
- S3 listing + download API: `GET /api/v1/s3/list` (paginated, OCR-extension-filtered) and `GET /api/v1/s3/download` (scope `s3:read`).
- CLI gained `extracto s3 export | ls | download` subcommands and MCP server gained `s3_export` and `s3_list` tools.
- Typesense added as a vector store for KB exports (auto-creates the collection schema on first upsert).
- History dialog gained a "Stopped" filter chip and distinguishes paused/stopped jobs from running and queued.

### Changed
- History markdown rendering now uses `remark-gfm` so tables, task lists, and strikethrough render properly in both the workspace preview and the History dialog.
- Stopped and queued OCR jobs no longer mis-display as "running" in History — the derived status maps `metadata.stage = "paused"` to a dedicated "stopped" tone.

## [0.5.2] - 2026-05-04

### Added
- Newly-uploaded PDFs preprocess in the background (page rendering) so the heavy work is finished by the time the user clicks Run OCR; rows show "Preparing..." while in flight.
- List-view rows in the page picker now toggle selection on click anywhere in the row (not just the checkbox), with hold-and-drag to bulk-select multiple pages.
- A small "Open" button on each list-view row jumps to that page in gallery view.

### Changed
- "Pages in parallel" moved from the main-view Advanced Options into Settings dialog → Model tab (with an "auto" badge when value is 0).
- "Prefer PDF text layer" toggle removed from the UI; the auto-detector decides per-page based on text-layer quality. CLI/MCP `--no-text-layer` flag stays as a power-user override.

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
