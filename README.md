<p align="center">
  <img src="extracto-banner.png" alt="Extracto" width="100%">
</p>

<p align="center">
  <strong>Your private document brain.</strong><br/>
  PDFs in, RAG out. Self-hosted. Plug everywhere.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#what-you-get">What you get</a> ·
  <a href="#plug-everywhere">Plug everywhere</a> ·
  <a href="https://extracto.help">Docs</a> ·
  <a href="./openapi.yaml">OpenAPI</a> ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/codelined-ag/Extracto/actions/workflows/ci.yml"><img src="https://github.com/codelined-ag/Extracto/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/codelined-ag/Extracto?color=brightgreen" alt="License"></a>
  <a href="https://github.com/codelined-ag/Extracto/pkgs/container/extracto"><img src="https://img.shields.io/badge/ghcr.io-extracto-blue?logo=docker" alt="GHCR"></a>
  <a href="https://github.com/codelined-ag/Extracto/stargazers"><img src="https://img.shields.io/github/stars/codelined-ag/Extracto?style=flat&color=ffb000" alt="Stars"></a>
</p>

<!--
  Drop the demo gif here once recorded. Suggested flow:
    drop a PDF → page-by-page progress → clean markdown out → one click "send to KB" → ask Claude a question against the new vector chunks.
  6 to 10 seconds. Loops. Replaces the screenshot below.
-->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/main-dark.png">
    <img src="docs/screenshots/main-light.png" alt="Extracto workspace" width="100%">
  </picture>
</p>

> **v0.6.0**: settings dialog regrouped into 4 task-oriented tabs (OCR, Knowledge base, Storage, Templates) with single-open collapsible sections, account-personal preferences split into a dedicated dialog, real-time per-page OCR progress, Markdown results that render with proper typographic hierarchy in workspace and history, plus broad auth/rate-limit/security hardening. See the [changelog](./CHANGELOG.md).

---

## Why

Most document-to-AI tools are SaaS. They cost per page, they see your documents, and they lock you into one provider. Extracto is the opposite: one Docker container, your machine, any vision model (local or hosted), output goes wherever you want it. Browser, code, agent, vector store. You pick.

---

## What you get

A **complete pipeline** from raw document to retrievable knowledge, in one container:

1. **Ingest** any PDF, image, or watched folder.
2. **Extract** with the vision model of your choice (Ollama, Mistral OCR, OpenRouter, any OpenAI-compatible endpoint).
3. **Post-process** with a second LLM pass (clean to markdown or strict JSON, with your own instruction).
4. **Chunk + embed + store** into Chroma, Qdrant, or Weaviate. Five chunking strategies including semantic (sentence-embed + topic-shift split) and hierarchical (preserves heading breadcrumbs).
5. **Retrieve** through a stable v1 REST API, an OpenAI-Chat-Completions adapter, an MCP server (Claude/Cursor/Codex/OpenClaw/Hermes), a typed CLI, or the browser UI.

Other things you don't need to bolt on:

- Per-user accounts, scoped API keys with rate limits, signed webhooks.
- Resumable jobs, page-by-page progress, searchable history.
- Optional S3/MinIO blob offload, Prometheus metrics, healthcheck.
- Five UI languages (English, Italian, French, Spanish, German).

---

## Quickstart

You need Docker. That's it.

### Fastest install (under a minute)

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/codelined-ag/Extracto/v0.6.0/scripts/quickstart.sh | bash
```

Pulls the prebuilt multi-arch image, runs a single container with an auto-generated `AUTH_SECRET` and a persistent SQLite volume, waits for the healthcheck, and prints the URL. No clone, no compose, no Ollama install. Open <http://localhost:3000>, sign up, and you're in.

### Full install (clone + compose stack + `extracto` CLI on PATH)

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/codelined-ag/Extracto/v0.6.0/scripts/install.sh | bash
```

```powershell
iwr -UseBasicParsing https://raw.githubusercontent.com/codelined-ag/Extracto/v0.6.0/scripts/install.ps1 | iex
```

The installer clones the repo at the pinned tag to `~/.local/share/extracto` (or `%LOCALAPPDATA%\Extracto`), sets up Docker + Ollama if missing, writes localhost-safe overrides to `.extracto.env`, drops an `extracto` launcher on PATH, and starts the stack.

> The full installer wraps `install-extracto.sh`, which on a fresh machine runs vendor scripts from `https://get.docker.com` and `https://ollama.com/install.sh` as **root** to provision Docker + Ollama. Skip Docker provisioning with `EXTRACTO_INSTALL_DOCKER=0` when Docker + Compose are already installed; skip Ollama install/startup with `EXTRACTO_INSTALL_OLLAMA=0` if you use hosted models or manage Ollama yourself. Set `EXTRACTO_REPO_REF=main` to track the bleeding edge instead of the pinned tag.

### S3-compatible storage (any provider)

Settings → Storage takes any S3-compatible endpoint: AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, Wasabi, Linode Object Storage, GCS, MinIO, Garage, Ceph RGW, SeaweedFS, on-prem appliances, etc. The endpoint URL is validated for SSRF (cloud-metadata IPs and link-local always blocked); private/loopback hosts (RFC1918, 127.0.0.1, host.docker.internal) require either `S3_ALLOW_LOOPBACK=1` for global opt-in or `S3_ALLOWED_HOSTS=minio.internal.corp,*.objects.internal` for granular access.

The launcher wraps the full API: `extracto ocr ./invoice.pdf`, `extracto jobs list`, `extracto kb export`, `extracto api-key create ...`. Full reference at [extracto.help/cli/overview](https://extracto.help/cli/overview).

<details>
<summary>Manual paths</summary>

**From source:**
```bash
git clone https://github.com/codelined-ag/Extracto.git
cd Extracto
./install-extracto.sh   # Linux/macOS
# or: .\scripts\extracto.ps1 install   # Windows (Docker Desktop + WSL2)
extracto on
```

**Single `docker run` (no launcher):**
```bash
docker run -d --name extracto -p 3000:3000 -v extracto-data:/app/data -e AUTH_SECRET="$(openssl rand -hex 32)" -e COOKIE_SECURE=false -e ALLOW_SIGNUP=1 ghcr.io/codelined-ag/extracto:v0.6.0
```

Multi-arch (`linux/amd64` + `linux/arm64`); pin a release tag instead of `:latest`. The checked-in compose defaults are production-biased (`COOKIE_SECURE=true`, bridge networking, signup disabled); the installer writes `.extracto.env` overrides for localhost onboarding.

</details>

---

## Plug everywhere

Same backend, four surfaces. Pick what fits.

| Surface | Use it when | Read |
|---|---|---|
| **Browser UI** | You're a human with a stack of PDFs | [How it works](https://extracto.help/how-it-works) |
| **REST API** (`/api/v1/*`) | You're building a document-intake pipeline | [API reference](https://extracto.help/api/overview) |
| **MCP server** | Your agent speaks MCP (Claude Desktop, Cursor, Codex, OpenClaw, Hermes) | [Agents](https://extracto.help/agents/overview) |
| **CLI + [`SKILL.md`](./SKILL.md)** | Your agent only has a shell tool (Claude Code, shell-based runners) | [Skill file](./SKILL.md) |
| **OpenAI-Chat adapter** | You already have OpenAI-SDK code; just point it at Extracto | [OpenAI compat](https://extracto.help/api/openai-compat) |

Agents get two first-class paths. The **MCP server** exposes seven tools (`ocr_submit`, `ocr_get`, `jobs_list`, `job_stop`, `kb_search`, `kb_export`, `presets_list`). The **`SKILL.md`** + typed CLI path is for agents that don't speak MCP: drop the skill file into the agent's context and it knows when to call `extracto ocr`, `extracto kb search`, `extracto jobs ...` from a shell.

---

## Documentation

Everything beyond a five-minute install lives at **[extracto.help](https://extracto.help)** in five languages:

- Configuration reference (every env var)
- Full v1 API guide (auth, OCR, jobs, presets, webhooks, KB export, search, metrics)
- CLI reference
- MCP setup for every supported client
- Knowledge-base export (chunking strategies, embedding providers, vector stores)
- Production checklist (auth secret, HTTPS, signup gate, rate limits, allowlists)
- Troubleshooting + ops (logs, metrics, retention, S3 offload, watched folders)
- Architecture tour

OpenAPI 3.1 spec at [`openapi.yaml`](./openapi.yaml). Import into Bruno, Postman, Insomnia, or any client generator.

---

## Star History

<a href="https://star-history.com/#codelined-ag/Extracto&Date">
  <img src="https://api.star-history.com/svg?repos=codelined-ag/Extracto&type=Date" alt="Star History" width="600"/>
</a>

---

## License

[MIT](./LICENSE) © codelined
