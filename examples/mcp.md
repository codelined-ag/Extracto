# Wire Extracto into an MCP-aware client

Extracto ships an MCP (Model Context Protocol) server at
`scripts/mcp-server.ts`. It exposes the v1 OCR API as agent tools so
Claude Desktop, Cursor, Codex, etc. can submit jobs and pull results
directly.

## Tools exposed

| Tool          | Purpose                                                           |
| ------------- | ----------------------------------------------------------------- |
| `ocr_submit`  | Submit one or more files (data URLs) for OCR.                     |
| `ocr_get`     | Fetch a job by id (status, extracted text, structured result).    |
| `jobs_list`   | List the caller's recent jobs (filter by status, paginate).       |
| `job_stop`    | Pause a running job at the next page checkpoint.                  |
| `kb_search`   | Full-text search across KB-exported jobs.                         |
| `presets_list`| List the caller's output presets.                                 |

## 1. Mint an Extracto API key

```bash
extracto api-key create user@example.com "mcp-client"
# Copy the extr_... value — it's shown once.
```

## 2. Configure the client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "extracto": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/extracto/scripts/mcp-server.ts"],
      "env": {
        "EXTRACTO_URL": "http://localhost:3000",
        "EXTRACTO_TOKEN": "extr_..."
      }
    }
  }
}
```

Restart Claude Desktop. The Extracto tools will appear in the slash-tool
picker.

### Cursor / Codex / generic stdio MCP

Same shape — point the client at `bun run scripts/mcp-server.ts` with
`EXTRACTO_URL` and `EXTRACTO_TOKEN` in the env.

## 3. Try it

Ask the assistant: *"Use extracto to OCR this image: data:image/png;base64,..."*
The model will call `ocr_submit`, then `ocr_get`, and return the text.

## Notes

- The server runs over stdio. No HTTP port is opened.
- All calls go through Extracto's normal bearer-auth + rate-limit path,
  so the API key's scopes apply.
- Set `OCR_MODEL=...` in the agent prompt or default it via the
  presets API.
