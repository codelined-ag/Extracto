# Examples

Drop-in integration recipes for Extracto's `/api/v1/*` surface. Each
file is self-contained — set `EXTRACTO_URL` (defaults to
`http://localhost:3000`) and `EXTRACTO_TOKEN` (mint with
`extracto api-key create <user-email> <name>`), then run.

| File | Purpose |
| --- | --- |
| `python_openai_sdk.py` | Use the OpenAI Python SDK against Extracto's chat-completions adapter to OCR an image. |
| `langchain_tool.ts` | Wrap Extracto as a LangChain tool callable from any agent. |
| `slack_webhook_handler.js` | Verify + format `job.completed` / `job.failed` webhook deliveries for Slack. |
| `n8n_workflow.json` | Importable n8n flow that watches a folder, OCRs each new file, and posts the result. |
| `mcp.md` | How to wire the bundled MCP server into Claude Desktop, Cursor, etc. |
| `websocket/` | Minimal Node WS demo (legacy). |
