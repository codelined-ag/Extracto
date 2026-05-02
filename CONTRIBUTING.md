# Contributing to Extracto

Thanks for considering a contribution. This is a small, opinionated project, so a few notes will save us both time.

## Ground rules

- **Open an issue first** for anything bigger than a typo or a one-line fix. A short conversation about scope catches dead-ends early.
- **Keep PRs focused.** One concern per PR. Refactors and feature work in the same PR are hard to review.
- **No drive-by formatting.** Don't reflow whole files when changing a few lines.
- **Tests pass and the build is clean.** `npm test` and `bun run build` both green before opening the PR.

## Local setup

You need [Docker](https://www.docker.com/products/docker-desktop/) and [Bun](https://bun.sh/) (or Node 20+).

```bash
git clone https://github.com/codelined-ag/extracto.git
cd extracto
bun install
bun run dev          # next dev on :3000
```

For the production-style run inside Docker (which is what real users get):

```bash
docker compose --env-file docker.env up -d --build
docker compose --env-file docker.env logs -f app
```

If you change `prisma/schema.prisma`, regenerate the client:

```bash
bun run db:generate
bun run db:push
```

## Tests

```bash
npm test              # vitest run, full suite
npm test -- --watch   # watch mode while you work
npm test -- some/path # filter by path
```

The suite hits 870+ tests covering the OCR pipeline, auth, embedding fallbacks, and the API routes. Aim to add at least one test per behavior change. Pure utilities under `src/lib/` are the easiest to cover; we keep React-tree tests light because the workspace UI is one big component (see `src/app/page.tsx`).

## Architecture in 90 seconds

- **Next.js 16 App Router**, built with `output: "standalone"`, served by Bun inside the container.
- **SQLite + Prisma**, single file at `db/custom.db` (dev) or `/app/data/custom.db` (container). Schema changes go through `prisma db push`.
- **Auth**: HMAC-SHA256 session cookies signed with `AUTH_SECRET`. Bearer tokens for the `/api/v1/*` headless surface. Read `src/lib/auth/` before touching anything.
- **OCR pipeline**: HTTP shell at `src/app/api/ocr/route.ts`, orchestrator at `src/lib/ocr/pipeline.ts`, per-provider runners under `src/lib/ocr/providers/`.
- **KB export**: per-user defaults at `src/lib/kb/defaults-store.ts`, vector-store adapters under `src/lib/kb/stores/` (Chroma, Qdrant, Weaviate). Gated by `KB_EXPORT_ENABLED`.
- **Route boundary**: `/api/*` is browser-internal (cookie auth, no version guarantee). `/api/v1/*` is the stable bearer-auth surface.

`CLAUDE.md` has the deeper tour.

## Adding a provider

1. Drop a new runner in `src/lib/ocr/providers/<name>.ts` exposing `runOcr` and (if applicable) `runProviderPostProcessing`.
2. Add it to `PROVIDER_HANDLERS` in `src/lib/ocr/pipeline.ts`.
3. Update `enforceProviderEndpointPolicy` (`src/lib/ocr/endpoint-policy.ts`) with a sensible default allowlist.
4. Surface it in `src/lib/api-types.ts` (`ProviderKind`, `normalizeProvider`).
5. Add it to the Settings dialog provider Select in `src/app/page.tsx`.
6. Tests for the runner (HTTP mocked) and policy.

## Adding a vector-store adapter

1. Drop an adapter in `src/lib/kb/stores/<name>.ts` implementing `VectorStoreAdapter` from `src/lib/kb/types.ts`.
2. Re-use `VectorStoreError` from `src/lib/kb/stores/error.ts`.
3. Add the kind to `VectorStoreKind` in `src/lib/kb/defaults-store.ts` and update the `DEFAULT_BASE_URL_BY_KIND` map.
4. Wire it into the dispatchers in `src/app/api/kb/export/route.ts` and `src/app/api/v1/export/kb/route.ts`.
5. Add the option to the Vector store Select in the Settings dialog.

## i18n

Strings live inline in `t("it", "en", "fr", "es", "de")` calls. All five languages are required for new strings. If you can't translate one, use the English text for the missing slot rather than leaving it empty. Pipeline backend messages are translated in `src/app/page-utils.ts` via `translatePipelineMessage`.

## Code style

- Don't add comments. Self-explanatory names carry the meaning.
- Don't add em dashes (`—`) anywhere in user-facing copy. Use parentheses, periods, or colons.
- No purple, blue, cyan, or fuchsia accents in the UI. Stay on the brand: coral primary, amber accent, warm cream/cocoa surfaces.
- Borders are forbidden. Surfaces differentiate via tone shifts and soft shadows.
- Inputs never grow a colored border on focus. The focus state is an inner glow tinted by `--primary`.

## Commits

Conventional-ish, lowercase, present tense. Subject line under 70 chars. Body explains the why. Group related changes into one commit; don't ship half-finished work behind a bigger commit.

## Releasing

For now we don't tag releases. When we do, the flow will be: bump `package.json`, write a `CHANGELOG.md` entry, tag, push tag, GitHub Actions builds and publishes.

## Bug reports

Include: what you did, what you expected, what happened, the relevant log lines from `docker compose logs app`, and your environment (OS, browser, Docker version).

## Security

Don't open public issues for security problems. Email security@codelined.ag (or the maintainers listed in the GitHub org) so we can coordinate a fix and a disclosure.
