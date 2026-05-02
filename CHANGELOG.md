# Changelog

## Unreleased

### Added
- MIT LICENSE.
- CONTRIBUTING.md with local setup, architecture overview, and contribution rules.
- `ALLOW_SIGNUP` env flag (default `1`) to gate `POST /api/auth/signup`.
- `WEBHOOK_ALLOWED_HOSTS` env allowlist; outgoing webhook deliveries reject private, loopback, and link-local hosts unconditionally.
- User menu in the header with quick links to provider, knowledge base, and sign out.
- Browser-language detection on first visit (falls back to English when no localStorage entry exists).
- `viewport.themeColor` now sets per-scheme browser chrome colors.
- `.dockerignore` excludes screenshots, tests, env files, and committed scratch files from the build context.

### Changed
- Body font is Manrope; mono is JetBrains Mono; display is Fraunces. Geist removed.
- Default UI language now English (was Italian) with auto-detect from `navigator.language`.
- Minimum signup password raised from 8 to 12 characters.
- `KB_EXPORT_ENABLED` defaults to `0` so the export endpoint is opt-in for self-hosters.
- `themeColor` moved from `metadata` to a `viewport` export to silence Next 16 build warnings.
- Lint re-enables `no-redeclare`, `no-unreachable`, and `react-hooks/rules-of-hooks`.

### Fixed
- File-count pluralization in the sidebar now passes all five languages (was English-only fallback).
- Empty preview "Click Run OCR" copy translated to it/en/fr/es/de.
- Wordmark "Extracto" no longer clips the italic descender or the period.
- Model chip below the Run button truncates cleanly instead of bleeding into the Advanced Options card.
- Off-palette `text-lime-400`, `bg-emerald-50/20`, `bg-destructive/12` replaced with brand tokens.
- Dialog close button `sr-only` label is now translatable via prop.
- HintInfo aria-label now mirrors the tooltip text.
- Removed two `repeat: Infinity` framer-motion loops on header decorations that ignored `prefers-reduced-motion`.
- Removed duplicate `<ChevronDown>` SVG in `page.tsx` (the canonical animated component is imported instead).
