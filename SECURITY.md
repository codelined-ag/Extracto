# Security Policy

## Reporting a Vulnerability

If you find a security issue in Extracto, please **do not** open a public
GitHub issue. Email the maintainer directly:

> **supporto@codelined.com**

Include:

- A description of the issue and its impact.
- A minimal reproduction (curl request, payload, or steps).
- Your environment (Extracto version / image tag, deployment mode).
- Whether you'd like credit in the release notes.

You'll get a first response within **72 hours**. We'll work with you on
a fix and a coordinated disclosure timeline (typical: fix + patched
release within 14 days, public disclosure 7 days after).

## Supported Versions

Only the latest minor release on `main` receives security patches.
Older minor versions are best-effort.

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |

## Threat Model (in scope)

- **Authentication bypass.** Any path that lets an unauthenticated
  caller reach an authenticated endpoint, or escalate scopes.
- **SSRF.** The OCR + KB + S3 features call user-supplied HTTP endpoints.
  Bypasses of `OLLAMA_ALLOWED_HOSTS`, `MISTRAL_ALLOWED_HOSTS`,
  `OPENROUTER_ALLOWED_HOSTS`, `OPENAI_COMPAT_ALLOWED_HOSTS`,
  `WEBHOOK_ALLOWED_HOSTS`, or the S3 endpoint policy (cloud-metadata IPs
  + RFC1918/loopback unless `S3_ALLOW_LOOPBACK=1` or
  `S3_ALLOWED_HOSTS` is set) count as SSRF.
- **Cross-tenant data leakage.** Any path that returns one user's
  jobs, settings, presets, webhooks, or API keys to another user.
- **Session/token theft.** Cookie or bearer-token disclosure;
  CSRF-style mutation without a same-origin check.
- **API-key escalation.** A bearer token reaching session-only routes
  (`/api/v1/keys`).
- **Webhook delivery to private network.** The default policy rejects
  loopback, link-local, and RFC1918 destinations; bypasses count.
- **Code execution via uploaded file.** Extracto opens PDFs and image
  bytes; bypasses of `data:image/*` parsing or the per-preview length
  cap that lead to RCE in the container.

## Out of Scope

- Issues that require an attacker who already has a valid session
  cookie or API key on the same account (these are abuse, not vulns).
- DOS via expensive OCR jobs — rate limits are configurable per key.
- Issues in third-party model providers (Mistral, OpenRouter, etc.).
- Bugs in development-only code (tests, scripts that aren't part of
  the runtime image).
- Self-hosted misconfiguration (e.g., running with `MIGRATE_ON_START=0`
  on a fresh DB).

## Hardening Notes for Operators

- Always set a strong `AUTH_SECRET` in `docker.env`. The entrypoint
  generates one if missing, but bring-your-own is preferred.
- Run behind TLS in production; set `COOKIE_SECURE=true` (default)
  so the session cookie is `Secure`.
- Pin `EXTRACTO_TAG` to a release tag; do not run production from `latest`.
- Keep the default bridge networking unless you explicitly need host mode.
- Configure `OLLAMA_ALLOWED_HOSTS`, `MISTRAL_ALLOWED_HOSTS`,
  `OPENROUTER_ALLOWED_HOSTS`, `OPENAI_COMPAT_ALLOWED_HOSTS` to the
  exact endpoints you use. Don't run with the defaults open in a
  multi-tenant deployment.
- Keep `ALLOW_SIGNUP=0` after bootstrapping the operator account.
- Set `METRICS_TOKEN` to gate the Prometheus surface.

## PGP

Reach out via the email above for a PGP key if you need encrypted
communication.
