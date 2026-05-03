<p align="center">
  <img src="extracto-banner.png" alt="Extracto" width="100%">
</p>

<p align="center">
  <strong>Turn any document into clean text.</strong><br/>
  UI for people, API for businesses, MCP for agents. Self-hosted, any model.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#who-its-for">Who it's for</a> ·
  <a href="https://extracto.help">Docs</a> ·
  <a href="./openapi.yaml">OpenAPI</a> ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/codelined-ag/Extracto/actions/workflows/ci.yml"><img src="https://github.com/codelined-ag/Extracto/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/codelined-ag/Extracto?color=brightgreen" alt="License"></a>
  <a href="https://github.com/codelined-ag/Extracto/pkgs/container/extracto"><img src="https://img.shields.io/badge/ghcr.io-extracto-blue?logo=docker" alt="GHCR"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/main-dark.png">
    <img src="docs/screenshots/main-light.png" alt="Extracto workspace" width="100%">
  </picture>
</p>

---

## Quickstart

You need Docker. That's it.

```bash
docker run -d --name extracto -p 3000:3000 -v extracto-data:/app/data -e AUTH_SECRET="$(openssl rand -hex 32)" ghcr.io/codelined-ag/extracto:latest
```

Open <http://localhost:3000>, sign up, you're in. Multi-arch (`linux/amd64` + `linux/arm64`); pin a release with `:v0.3.0` instead of `:latest`.

Other install paths (one-shot installer with Ollama auto-install, plain `docker compose`, source build, Windows / macOS specifics, watched-folder ingestion, S3 offload, Prometheus, etc.) live at **[extracto.help](https://extracto.help)**.

---

## What it does

You give Extracto a PDF, an image, or a folder of them. It runs OCR with the model of your choice and gives you back clean text.

- **Four provider families:** Ollama (fully offline, no key), Mistral OCR, OpenRouter, any OpenAI-compatible endpoint.
- **Multi-page PDFs**, resumable jobs, optional post-processing pass, searchable history.
- **Knowledge-base export** to Chroma / Qdrant / Weaviate with five chunking strategies (`fixed`, `sentence`, `paragraph`, `hierarchical`, `semantic`).
- **Watched folders** for fire-and-forget ingestion.
- **Per-user accounts**, scoped API keys with rate limits, signed webhooks.
- **Five UI languages:** English (default), Italian, French, Spanish, German.

One Docker container. SQLite for the database, Bun for the runtime, Next.js 16 for the app.

---

## Who it's for

Three audiences, one backend. Same jobs, same history, same provider settings — pick the surface that fits.

### Regular people who want their own OCR

You have a stack of PDFs, scans, photos of receipts, or handwritten notes you'd like as searchable text. You don't want to upload private documents to a third-party SaaS. **Drag-and-drop UI**, runs entirely on your machine with [Ollama](https://ollama.com) (no cloud, no key, no quota), or BYO key for a hosted vision model when you want better accuracy.

→ Install above, then [open the app](http://localhost:3000) and follow your nose.

### Businesses that need an OCR API on their own infrastructure

You're building a document-intake pipeline, a back-office tool, or a regulated workflow where customer documents can't leave your network. **Stable bearer-auth REST API** with semver guarantees, scoped per-user keys, signed webhooks, drop-in OpenAI-Chat-Completions adapter, watched-folder ingestion, KB export to Chroma / Qdrant / Weaviate, Prometheus metrics, optional S3 / MinIO blob offload.

→ See the [API guide on extracto.help](https://extracto.help/api) and the [`openapi.yaml`](./openapi.yaml) spec.

### LLM agents (Claude Desktop, Cursor, Codex, OpenClaw, Hermes)

You're writing an agent that needs to read documents and you want a tool, not an API client. **First-class MCP server** (stdio, seven tools), **typed CLI** for shell-tool integration, and a **pre-written [`SKILL.md`](./SKILL.md)** describing when to invoke which tool so the agent picks correctly without trial-and-error.

→ See the [agent guide on extracto.help](https://extracto.help/agents) and the [MCP setup walkthrough](./examples/mcp.md).

---

## Documentation

Everything beyond a five-minute install lives at **[extracto.help](https://extracto.help)**:

- Configuration reference (every env var, every default)
- Full v1 API guide (auth, OCR, jobs, presets, webhooks, KB export, search)
- CLI reference (`extracto ocr`, `extracto jobs`, `extracto kb export`, `extracto api-key`, …)
- MCP setup for every supported client
- Knowledge-base export (chunking strategies, embedding providers, vector stores)
- Production checklist (auth secret, HTTPS, signup gate, rate limits, allowlists)
- Troubleshooting + ops (logs, metrics, retention, S3 offload, watched folders)
- Architecture tour and contribution guide

The [`openapi.yaml`](./openapi.yaml) spec covers the full `/api/v1/*` surface — import into Bruno, Postman, Insomnia, or any client generator.

---

## License

[MIT](./LICENSE) © codelined
