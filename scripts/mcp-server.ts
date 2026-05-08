#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const EXTRACTO_URL = (process.env.EXTRACTO_URL || "http://localhost:3000").replace(/\/+$/u, "");
const EXTRACTO_TOKEN = process.env.EXTRACTO_TOKEN || "";

if (!EXTRACTO_TOKEN) {
  console.error("EXTRACTO_TOKEN env var is required (mint one with `extracto api-key create`).");
  process.exit(1);
}

interface ExtractoFetchInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

async function call<T>(path: string, init: ExtractoFetchInit = {}): Promise<T> {
  const res = await fetch(`${EXTRACTO_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${EXTRACTO_TOKEN}`,
      Origin: EXTRACTO_URL,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    const detail = (payload as { error?: string }).error ?? text.slice(0, 400) ?? res.statusText;
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${detail}`);
  }
  return payload as T;
}

function asTextResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: "extracto",
  version: "0.3.0",
});

server.tool(
  "ocr_submit",
  "Submit one or more files for OCR. Returns the batch id and per-file job ids; poll ocr_get to retrieve results.",
  {
    files: z
      .array(
        z.object({
          fileName: z.string(),
          model: z.string(),
          preview: z.string().describe("Data URL (data:image/* or data:application/pdf;base64,...)"),
          sourcePdf: z
            .string()
            .max(180_000_000)
            .optional()
            .describe(
              "Original PDF as a data URL. Enables document anchoring and the text-layer fast-path on the server. Optional; pass the same bytes you'd put in `preview` when the caller pre-rendered images. Capped at ~128 MB raw (180M base64 chars) to match the server body limit.",
            ),
          pages: z
            .array(z.string())
            .optional()
            .describe(
              "Per-page data URLs when the caller has pre-split a PDF into images. Length must equal pageNumbers when both are provided.",
            ),
          pageNumbers: z
            .array(z.number().int().min(1))
            .optional()
            .describe(
              "1-indexed original page numbers parallel to `pages`. Use to OCR a subset of a PDF (e.g. [1,2,5,7]). Required only when pre-splitting; otherwise the server processes every page in order.",
            ),
          priority: z
            .number()
            .int()
            .min(-10)
            .max(10)
            .optional()
            .describe("Per-file scheduler priority. Higher runs first; default 0."),
          settings: z
            .object({
              language: z.string().optional(),
              tableDetection: z.boolean().optional(),
              handwritingRecognition: z.boolean().optional(),
              preserveFormatting: z.boolean().optional(),
              customPrompt: z.string().optional(),
              quality: z.number().int().min(0).max(100).optional(),
              preferTextLayer: z
                .boolean()
                .optional()
                .describe(
                  "When true (default) and the PDF has a rich text layer, skip the VLM call for that page and emit text-layer markdown directly. Free + lossless for born-digital PDFs.",
                ),
              documentPreset: z
                .enum(["generic", "academic", "invoice", "contract", "form"])
                .optional()
                .describe(
                  "Per-document-type prompt preset that sharpens extraction for the specified shape (e.g. invoice => structured JSON of line items).",
                ),
              pageConcurrency: z
                .number()
                .int()
                .min(0)
                .max(16)
                .optional()
                .describe(
                  "How many pages to OCR in parallel. 0 = auto (per-provider sane default: ollama=1, mistral=4, openrouter=4, openai_compat=2). Clamped to 1..16.",
                ),
              piiRedaction: z
                .boolean()
                .optional()
                .describe(
                  "When true, server redacts emails, phone numbers, SSNs, credit cards, IBANs, IPs, URLs, and dates of birth from extracted text and per-page records before persisting. Off by default.",
                ),
            })
            .partial()
            .optional(),
          postProcessing: z
            .object({
              enabled: z.boolean().optional(),
              instruction: z.string().optional(),
              outputFormat: z.enum(["markdown", "json"]).optional(),
              model: z.string().optional(),
              template: z
                .enum(["custom", "translate", "summarize-3sentence", "summarize-executive", "extract-actions"])
                .optional()
                .describe(
                  "Server-built post-processing instruction. 'translate' requires targetLanguage; the summarize/extract templates ignore the user instruction. Default 'custom' uses the free-form instruction field.",
                ),
              targetLanguage: z
                .string()
                .optional()
                .describe(
                  "Target language for the 'translate' template (e.g. 'Italian', 'Brazilian Portuguese', 'zh-CN'). Ignored for other templates.",
                ),
            })
            .partial()
            .optional(),
        }),
      )
      .min(1)
      .describe("One file per array entry. preview must already be a data URL."),
  },
  async ({ files }) => {
    const result = await call("/api/v1/ocr/batch", { method: "POST", body: { files } });
    return asTextResult(result);
  },
);

server.tool(
  "job_export",
  "Render a COMPLETED job's text into a downloadable file. Supported formats: md (markdown), json (full structured result), txt (plain text), html, docx, rtf, csv (markdown tables, falls back to one-line dump for prose), xlsx (each markdown table is a separate sheet, prose dumps to a single sheet), obsidian (zip with a per-job folder containing the index note, per-page notes, and attachments; ready to drop into a vault), zip (flat archive with index.md, per-page markdown files under pages/, and a joined all-pages.md). Returns the file as base64.",
  {
    jobId: z.string(),
    format: z.enum(["md", "json", "txt", "html", "docx", "rtf", "csv", "xlsx", "obsidian", "zip"]),
  },
  async ({ jobId, format }) => {
    const url = `/api/v1/jobs/${encodeURIComponent(jobId)}/export?format=${encodeURIComponent(format)}`;
    const res = await fetch(`${EXTRACTO_URL}${url}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${EXTRACTO_TOKEN}`, Origin: EXTRACTO_URL },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET ${url} -> ${res.status}: ${text.slice(0, 400)}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const filename = filenameMatch?.[1] ?? `${jobId}.${format}`;
    return asTextResult({
      filename,
      contentType: res.headers.get("Content-Type"),
      base64: buffer.toString("base64"),
      size: buffer.length,
    });
  },
);

server.tool(
  "job_equations",
  "Extract LaTeX equations from a COMPLETED job. Display equations are detected as $$..$$, inline as $..$. Best results when the job ran with documentPreset='academic' so the OCR prompt asks the model to wrap math in TeX delimiters.",
  { jobId: z.string() },
  async ({ jobId }) =>
    asTextResult(await call(`/api/v1/jobs/${encodeURIComponent(jobId)}/equations`)),
);

server.tool(
  "job_form_fields",
  "Extract structured form fields from a COMPLETED OCR job whose result includes a form-shaped block (typically when documentPreset='form' was used). Returns each field as { field, value, page? } plus a flat byField map.",
  { jobId: z.string() },
  async ({ jobId }) =>
    asTextResult(await call(`/api/v1/jobs/${encodeURIComponent(jobId)}/form-fields`)),
);

server.tool(
  "e2e_status",
  "Get the user's current E2E key registration status: whether a public key is registered, its fingerprint, and when it was registered.",
  {},
  async () => asTextResult(await call("/api/v1/e2e/key")),
);

server.tool(
  "e2e_encrypt",
  "Encrypt a chunk of text with the user's registered RSA public key using AES-256-GCM + RSA-OAEP-SHA256 envelope encryption. Returns the sealed envelope. The user must decrypt client-side with their private key; the server never sees the plaintext after this call returns. Requires a previously registered public key (via PUT /api/v1/e2e/key from the browser).",
  { text: z.string().min(1) },
  async ({ text }) =>
    asTextResult(await call("/api/v1/e2e/encrypt", { method: "POST", body: { text } })),
);

server.tool(
  "pii_redact",
  "Run server-side PII redaction over a chunk of text. Replaces emails, phones (>=7 digits), Luhn-valid credit cards, IBAN-shaped strings, IPv4 addresses, URLs, dates of birth, and SSNs with [REDACTED:KIND:N] placeholders. Returns the redacted text plus the audit (kind + char offsets only, no original values).",
  { text: z.string().min(1) },
  async ({ text }) =>
    asTextResult(await call("/api/v1/pii/redact", { method: "POST", body: { text } })),
);

server.tool(
  "recommendations",
  "Get model recommendations per document type based on the user's recent OCR history. For each document type seen, returns the highest success-rate model + alternatives + an insufficientData flag when there aren't enough samples to be confident.",
  {
    days: z.number().int().min(1).max(365).default(90).describe("Lookback window in days (1 to 365)."),
  },
  async ({ days }) =>
    asTextResult(await call(`/api/v1/recommendations?days=${days}`)),
);

server.tool(
  "ocr_compare",
  "Submit one input file to N models in parallel and get a comparisonId. Use ocr_comparison_get to fetch the per-model outputs and the server-computed word-level diff against the first model.",
  {
    fileName: z.string(),
    preview: z.string().describe("Data URL (data:image/* or data:application/pdf;base64,...)"),
    models: z.array(z.string()).min(2).max(4).describe("2 to 4 model ids to compare"),
    pages: z.array(z.string()).optional(),
    pageNumbers: z.array(z.number().int().min(1)).optional(),
    sourcePdf: z.string().max(180_000_000).optional(),
  },
  async (input) =>
    asTextResult(await call("/api/v1/ocr/compare", { method: "POST", body: input })),
);

server.tool(
  "ocr_comparison_get",
  "Fetch a comparison by id. Returns each model's job + extractedText, plus all-pairs word-level diffs (N(N-1)/2 per comparison).",
  { comparisonId: z.string() },
  async ({ comparisonId }) =>
    asTextResult(
      await call(`/api/v1/ocr/compare?id=${encodeURIComponent(comparisonId)}`),
    ),
);

server.tool(
  "ocr_estimate",
  "Estimate the dollar cost of running OCR on a set of pages before submitting. Pricing is fetched live (OpenRouter, LiteLLM mirror), static (Mistral OCR per-page rates), or $0 (Ollama, unknown self-hosted). Returns a breakdown with per-page rate, total, and warnings about pricing-source confidence.",
  {
    files: z
      .array(
        z.object({
          fileName: z.string().optional(),
          pageCount: z.number().int().min(1).max(5000),
        }),
      )
      .min(1)
      .max(200)
      .describe("One entry per file. pageCount is the number of pages to OCR."),
    model: z.string().describe("Model id that will run the OCR (e.g. 'mistral-ocr-latest', 'anthropic/claude-3.5-sonnet')."),
    provider: z
      .enum(["ollama", "mistral", "openrouter", "openai_compat"])
      .optional()
      .describe("Defaults to the caller's saved provider if omitted."),
    apiEndpoint: z.string().optional().describe("Defaults to the caller's saved endpoint if omitted."),
    postProcessing: z
      .object({
        enabled: z.boolean().optional(),
        model: z.string().optional(),
        outputFormat: z.enum(["markdown", "json"]).optional(),
      })
      .partial()
      .optional()
      .describe("Optional post-processing pass added to the estimate."),
    outputTokensPerPage: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Override the 800 tokens/page output heuristic."),
    inputTokensPerPage: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Override the 1445 tokens/page input heuristic (only used when the model has no flat per-image rate)."),
  },
  async (input) =>
    asTextResult(await call("/api/v1/ocr/estimate", { method: "POST", body: input })),
);

server.tool(
  "ocr_get",
  "Fetch a single OCR job (id, status, extractedText, structured result).",
  { jobId: z.string() },
  async ({ jobId }) => asTextResult(await call(`/api/jobs/${encodeURIComponent(jobId)}`)),
);

server.tool(
  "jobs_list",
  "List the caller's recent OCR jobs (newest first). All filters are AND-combined; tagIds is OR-combined within itself.",
  {
    limit: z.number().int().min(1).max(100).optional(),
    status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
    q: z.string().optional().describe("Substring match on fileName. Case-insensitive for ASCII characters."),
    model: z.string().optional().describe("Substring match on the job's model id. Case-insensitive for ASCII."),
    from: z
      .string()
      .optional()
      .describe("ISO-8601 lower bound on createdAt (inclusive). Examples: 2026-01-01, 2026-01-01T00:00:00Z."),
    to: z
      .string()
      .optional()
      .describe("ISO-8601 upper bound on createdAt (inclusive). A bare date (YYYY-MM-DD) is treated as inclusive end-of-day UTC."),
    tagIds: z.array(z.string()).optional().describe("Match jobs that have at least one of these tag ids."),
  },
  async ({ limit, status, q, model, from, to, tagIds }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    if (model) params.set("model", model);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (tagIds && tagIds.length > 0) params.set("tagIds", tagIds.join(","));
    const query = params.size ? `?${params.toString()}` : "";
    return asTextResult(await call(`/api/jobs${query}`));
  },
);

server.tool(
  "job_stop",
  "Request a running job to stop and pause at the next page checkpoint.",
  { jobId: z.string() },
  async ({ jobId }) =>
    asTextResult(
      await call(`/api/jobs/${encodeURIComponent(jobId)}/control`, {
        method: "POST",
        body: { action: "stop" },
      }),
    ),
);

const TAG_COLOR_ENUM = z.enum([
  "slate",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
]);

server.tool(
  "tags_list",
  "List the caller's tags with the count of jobs each tag is applied to.",
  {},
  async () => asTextResult(await call("/api/v1/tags")),
);

server.tool(
  "tags_create",
  "Create a tag, or update its color if a tag with the same name already exists.",
  {
    name: z.string().min(1).max(32),
    color: TAG_COLOR_ENUM.optional(),
  },
  async (input) => asTextResult(await call("/api/v1/tags", { method: "POST", body: input })),
);

server.tool(
  "tags_update",
  "Rename a tag and/or change its color. At least one of `name` or `color` is required.",
  {
    id: z.string(),
    name: z.string().min(1).max(32).optional(),
    color: TAG_COLOR_ENUM.optional(),
  },
  async ({ id, ...rest }) => {
    if (rest.name === undefined && rest.color === undefined) {
      throw new Error("tags_update requires at least one of name or color");
    }
    return asTextResult(
      await call(`/api/v1/tags/${encodeURIComponent(id)}`, { method: "PATCH", body: rest }),
    );
  },
);

server.tool(
  "tags_delete",
  "Delete a tag. The tag is also removed from any jobs it was applied to.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(
      await call(`/api/v1/tags/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ),
);

server.tool(
  "jobs_bulk_tag",
  "Apply tags to many jobs at once. Default mode 'add' is a union (idempotent on duplicates). Mode 'replace' clears existing tags on each job and writes the new set; 'replace' with an empty tagIds array is destructive and strips all tags from the listed jobs.",
  {
    jobIds: z.array(z.string()).min(1).max(200),
    tagIds: z.array(z.string()),
    mode: z.enum(["add", "replace"]).optional(),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/jobs/bulk/tags", { method: "POST", body: input }),
    ),
);

server.tool(
  "job_edit_page",
  "Replace the markdown text of a single page on a COMPLETED job. The previous text is appended to the per-page edit history; the job's extractedText is re-stitched. Marks the job's prior exports as stale.",
  {
    jobId: z.string(),
    pageNumber: z.number().int().min(1),
    text: z.string().max(1_000_000),
  },
  async ({ jobId, pageNumber, text }) =>
    asTextResult(
      await call(`/api/v1/jobs/${encodeURIComponent(jobId)}/pages/${pageNumber}`, {
        method: "PATCH",
        body: { text },
      }),
    ),
);

server.tool(
  "job_page_history",
  "Fetch the edit history for one page on a job. Each entry has the prior text, characterCount, and editedAt timestamp; the newest entry is first.",
  {
    jobId: z.string(),
    pageNumber: z.number().int().min(1),
  },
  async ({ jobId, pageNumber }) =>
    asTextResult(
      await call(`/api/v1/jobs/${encodeURIComponent(jobId)}/pages/${pageNumber}`),
    ),
);

server.tool(
  "job_set_tags",
  "Replace the set of tags applied to a job. Pass an empty array to clear all tags.",
  { jobId: z.string(), tagIds: z.array(z.string()) },
  async ({ jobId, tagIds }) =>
    asTextResult(
      await call(`/api/v1/jobs/${encodeURIComponent(jobId)}/tags`, {
        method: "PUT",
        body: { tagIds },
      }),
    ),
);

const SAVED_SEARCH_FILTERS = z
  .object({
    q: z.string().optional(),
    status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    model: z.string().optional(),
    tagIds: z.array(z.string()).optional(),
  })
  .partial();

server.tool(
  "saved_searches_list",
  "List the caller's saved History searches with their filter payloads.",
  {},
  async () => asTextResult(await call("/api/v1/saved-searches")),
);

server.tool(
  "saved_searches_save",
  "Create or update a saved search. Idempotent on `name`: re-using an existing name overwrites that search's filters.",
  {
    name: z.string().min(1).max(64),
    filters: SAVED_SEARCH_FILTERS,
  },
  async (input) =>
    asTextResult(await call("/api/v1/saved-searches", { method: "POST", body: input })),
);

server.tool(
  "saved_searches_rename",
  "Rename a saved search without rewriting its filters. 409 if another saved search already uses the new name.",
  { id: z.string(), name: z.string().min(1).max(64) },
  async ({ id, name }) =>
    asTextResult(
      await call(`/api/v1/saved-searches/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { name },
      }),
    ),
);

server.tool(
  "saved_searches_delete",
  "Delete a saved search by id.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(
      await call(`/api/v1/saved-searches/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ),
);

server.tool(
  "kb_search",
  "Full-text search across the caller's KB-exported jobs.",
  {
    q: z.string(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  async ({ q, limit }) => {
    const params = new URLSearchParams({ q });
    if (limit) params.set("limit", String(limit));
    return asTextResult(await call(`/api/v1/search?${params.toString()}`));
  },
);

server.tool(
  "presets_list",
  "List the caller's output presets.",
  {},
  async () => asTextResult(await call("/api/v1/presets")),
);

server.tool(
  "presets_create",
  "Create an output preset (named bundle of provider/model/settings/postProcessing).",
  {
    name: z.string(),
    description: z.string().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    postProcessing: z.record(z.string(), z.unknown()).optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
  },
  async (input) => asTextResult(await call("/api/v1/presets", { method: "POST", body: input })),
);

server.tool(
  "presets_delete",
  "Delete an output preset by id.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(await call(`/api/v1/presets/${encodeURIComponent(id)}`, { method: "DELETE" })),
);

server.tool(
  "keys_list",
  "List the caller's API keys (id, label, scopes, createdAt, lastUsedAt). Secrets are never returned.",
  {},
  async () => asTextResult(await call("/api/v1/keys")),
);

server.tool(
  "keys_create",
  "Create a new API key. Returns the plaintext key once; store it now.",
  {
    label: z.string(),
    scopes: z.array(z.string()).optional(),
    rateLimitPerMinute: z.number().int().positive().optional(),
  },
  async (input) => asTextResult(await call("/api/v1/keys", { method: "POST", body: input })),
);

server.tool(
  "keys_delete",
  "Revoke an API key by id.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(await call(`/api/v1/keys/${encodeURIComponent(id)}`, { method: "DELETE" })),
);

server.tool(
  "keys_rotate",
  "Rotate an API key in place. Returns the new plaintext key once; the previous secret is revoked. The id stays stable so dependent callers can update via Authorization: Bearer <new>.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(await call(`/api/v1/keys/${encodeURIComponent(id)}/rotate`, { method: "POST", body: {} })),
);

server.tool(
  "metrics_get",
  "Aggregate usage and queue metrics for the caller (job counts, processing time, OCR pages, by-day buckets, by-provider/model).",
  {},
  async () => asTextResult(await call("/api/v1/metrics")),
);

server.tool(
  "kb_export",
  "Chunk + embed + push a completed OCR job's text to a vector store. Strategies: fixed (char-window with overlap), sentence (sentence-merge), paragraph (paragraph-merge), hierarchical (markdown-heading-aware with breadcrumb metadata), semantic (embedding-similarity boundary detection — embeds sentences once, splits where consecutive cosine distance exceeds the breakpointPercentile).",
  {
    jobId: z.string(),
    collectionName: z.string(),
    vectorStore: z.object({
      kind: z.enum(["chroma", "qdrant", "weaviate", "milvus", "opensearch", "pinecone", "typesense"]),
      baseUrl: z.string().url(),
      apiKey: z.string().optional(),
      dimensions: z.number().int().positive().optional(),
    }),
    embedding: z.object({
      provider: z.enum(["ollama", "openrouter", "openai_compat"]),
      apiEndpoint: z.string().url(),
      apiKey: z.string().optional(),
      model: z.string(),
      dimensions: z.number().int().positive().optional(),
    }),
    chunking: z.object({
      strategy: z.enum(["fixed", "sentence", "paragraph", "hierarchical", "semantic"]),
      maxChunkSize: z.number().int().min(1).max(10000),
      overlap: z.number().int().min(0).optional(),
      minChunkSize: z.number().int().min(0).optional(),
      breakpointPercentile: z.number().min(0).max(100).optional(),
      maxHeadingDepth: z.number().int().min(1).max(6).optional(),
    }),
    embeddingConcurrency: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .describe(
        "How many parallel embedding-batch requests to fan out. Default 1 = single batch (current behavior). Higher values speed up large exports against providers with high concurrent capacity (OpenRouter, hosted OpenAI-compat). Keep at 1 for local Ollama unless OLLAMA_NUM_PARALLEL is raised.",
      ),
  },
  async (input) => asTextResult(await call("/api/v1/export/kb", { method: "POST", body: input })),
);

server.tool(
  "kb_test_connection",
  "Probe any supported vector store (Chroma, Qdrant, Weaviate, Milvus, OpenSearch, Pinecone, Typesense) for reachability and auth before running a KB export. Returns latency, server version when available, and the probed endpoint path. No data is written; safe to call repeatedly.",
  {
    kind: z.enum(["chroma", "qdrant", "weaviate", "milvus", "opensearch", "pinecone", "typesense"]),
    baseUrl: z.string().url(),
    apiKey: z.string().optional(),
  },
  async (input) => asTextResult(await call("/api/v1/kb/test-connection", { method: "POST", body: input })),
);

server.tool(
  "s3_export",
  "Upload a completed OCR job's markdown + JSON to the user's pre-configured S3 bucket. Credentials live on the Extracto server (Settings → S3) and never round-trip through the client. Returns the bucket and object keys. Defaults to wait=true: the call blocks until the upload finishes.",
  {
    jobId: z.string().describe("ID of the OCR job whose results to upload."),
    keyPrefix: z
      .string()
      .optional()
      .describe(
        "Optional sub-prefix appended under the user's configured prefix. Defaults to a slugified version of the job's fileName.",
      ),
    wait: z.boolean().optional().describe("Default true. When false, returns {exportId} immediately."),
  },
  async (input) => asTextResult(await call("/api/v1/export/s3", { method: "POST", body: input })),
);

server.tool(
  "s3_list",
  "List objects in the user's configured S3 bucket under a sub-prefix. By default, only OCR-able file extensions (.pdf, .png, .jpg, .jpeg, .webp, .tif, .tiff, .bmp, .gif, .heic, .heif) are returned. Pass all=true to lift that filter. Returns a paginated result with nextToken when more results are available.",
  {
    prefix: z.string().optional().describe("Sub-prefix appended under the user's configured prefix."),
    pageSize: z.number().int().min(1).max(200).optional(),
    token: z.string().optional().describe("Continuation token from a prior response's nextToken."),
    all: z.boolean().optional().describe("When true, do not filter by OCR-able extensions."),
  },
  async (input) => {
    const qs = new URLSearchParams();
    if (input.prefix) qs.set("prefix", input.prefix);
    if (input.pageSize) qs.set("pageSize", String(input.pageSize));
    if (input.token) qs.set("token", input.token);
    if (input.all) qs.set("all", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return asTextResult(await call(`/api/v1/s3/list${suffix}`));
  },
);

server.tool(
  "integrations_list",
  "List the user's connected cloud-drive integrations and which providers the operator has configured at the instance level.",
  {},
  async () => asTextResult(await call("/api/v1/integrations")),
);

server.tool(
  "dropbox_list_folder",
  "List a Dropbox folder. Pass an empty path or '/' to list the App folder root. Returns each entry's kind (file/folder), name, path, size, and modified timestamp.",
  { path: z.string().default("") },
  async ({ path }) =>
    asTextResult(await call(`/api/v1/integrations/dropbox/list?path=${encodeURIComponent(path)}`)),
);

server.tool(
  "dropbox_import",
  "Download a file from the user's Dropbox and submit it for OCR. Returns a jobId. Supports pdf, png, jpg, webp up to 32 MiB.",
  {
    path: z.string().describe("Dropbox file path (e.g. '/Apps/Extracto/invoice.pdf')."),
    model: z.string(),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/integrations/dropbox/import", { method: "POST", body: input }),
    ),
);

server.tool(
  "dropbox_push",
  "Push a COMPLETED job's text back into Dropbox in the chosen format. The filename comes from the original job; pass `folder` to control where it lands ('/' or empty drops it at the root of the configured app folder).",
  {
    jobId: z.string(),
    folder: z.string().default(""),
    format: z.enum(["md", "json", "txt", "html", "docx", "rtf", "csv", "xlsx", "obsidian", "zip"]).default("md"),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/integrations/dropbox/push", { method: "POST", body: input }),
    ),
);

server.tool(
  "google_drive_list_folder",
  "List a Google Drive folder. Pass an empty string or 'root' to list the My Drive root. Returns each entry's id, name, mimeType, kind (file/folder), size, and modified timestamp.",
  { folderId: z.string().default("root") },
  async ({ folderId }) =>
    asTextResult(
      await call(`/api/v1/integrations/google_drive/list?folderId=${encodeURIComponent(folderId)}`),
    ),
);

server.tool(
  "google_drive_import",
  "Download a file from the user's Google Drive (by file id) and submit it for OCR. Returns a jobId. Supports pdf, png, jpg, webp up to 32 MiB.",
  {
    fileId: z.string().describe("Google Drive file id."),
    model: z.string(),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/integrations/google_drive/import", { method: "POST", body: input }),
    ),
);

server.tool(
  "google_drive_push",
  "Push a COMPLETED job's text back into Google Drive in the chosen format. Pass `parentId` to control the destination folder (empty falls back to My Drive root).",
  {
    jobId: z.string(),
    parentId: z.string().default(""),
    format: z.enum(["md", "json", "txt", "html", "docx", "rtf", "csv", "xlsx", "obsidian", "zip"]).default("md"),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/integrations/google_drive/push", { method: "POST", body: input }),
    ),
);

server.tool(
  "onedrive_list_folder",
  "List a OneDrive folder. Pass an empty string to list the App folder root. Returns each entry's id, name, kind (file/folder), mimeType, size, and modified timestamp.",
  { folderId: z.string().default("") },
  async ({ folderId }) =>
    asTextResult(
      await call(`/api/v1/integrations/onedrive/list?folderId=${encodeURIComponent(folderId)}`),
    ),
);

server.tool(
  "onedrive_import",
  "Download a file from the user's OneDrive (by item id) and submit it for OCR. Returns a jobId. Supports pdf, png, jpg, webp up to 32 MiB.",
  {
    fileId: z.string().describe("OneDrive item id."),
    model: z.string(),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/integrations/onedrive/import", { method: "POST", body: input }),
    ),
);

server.tool(
  "onedrive_push",
  "Push a COMPLETED job's text back into OneDrive in the chosen format. Pass `parentId` to control the destination folder (empty falls back to the App folder root).",
  {
    jobId: z.string(),
    parentId: z.string().default(""),
    format: z.enum(["md", "json", "txt", "html", "docx", "rtf", "csv", "xlsx", "obsidian", "zip"]).default("md"),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/integrations/onedrive/push", { method: "POST", body: input }),
    ),
);

server.tool(
  "integrations_status",
  "Show which cloud integrations (Dropbox, Google Drive, OneDrive) are available on this server and which the user has connected. Returns availability flags + each connection's account label and connected-at timestamp.",
  {},
  async () => asTextResult(await call("/api/v1/integrations")),
);

server.tool(
  "oauth_app_status",
  "Show whether the user has personal OAuth credentials saved for a provider, falling back to server creds. Returns source ('user' | 'server' | 'none'), clientIdLast4, and the redirectUri to register with the provider.",
  { provider: z.enum(["dropbox", "google_drive", "onedrive"]) },
  async ({ provider }) =>
    asTextResult(await call(`/api/v1/integrations/${provider}/oauth-app`)),
);

server.tool(
  "oauth_app_set",
  "Save the user's own OAuth client_id + client_secret for a provider. Stored encrypted. Overrides any server-wide credentials.",
  {
    provider: z.enum(["dropbox", "google_drive", "onedrive"]),
    clientId: z.string(),
    clientSecret: z.string(),
  },
  async ({ provider, clientId, clientSecret }) =>
    asTextResult(
      await call(`/api/v1/integrations/${provider}/oauth-app`, {
        method: "PUT",
        body: { clientId, clientSecret },
      }),
    ),
);

server.tool(
  "oauth_app_clear",
  "Delete the user's saved OAuth credentials for a provider. Falls back to server-wide creds if any.",
  { provider: z.enum(["dropbox", "google_drive", "onedrive"]) },
  async ({ provider }) =>
    asTextResult(
      await call(`/api/v1/integrations/${provider}/oauth-app`, { method: "DELETE" }),
    ),
);

server.tool(
  "integration_disconnect",
  "Disconnect a cloud provider (Dropbox / Google Drive / OneDrive). Best-effort revokes the OAuth token at the provider before deleting the local row.",
  { provider: z.enum(["dropbox", "google_drive", "onedrive"]) },
  async ({ provider }) =>
    asTextResult(await call(`/api/v1/integrations/${provider}`, { method: "DELETE" })),
);

server.tool(
  "webhooks_list",
  "List the user's registered webhooks. Each entry includes id, url, events, active, lastFiredAt, failureCount.",
  {},
  async () => asTextResult(await call("/api/v1/webhooks")),
);

server.tool(
  "webhooks_create",
  "Register a new webhook. Returns a one-time HMAC signing secret in the response. Save it now — it is not shown again. The receiver must verify the X-Extracto-Signature header (t=<unix>,v1=<hex>) using HMAC-SHA256 of `${timestamp}.${body}` with the secret.",
  {
    url: z.string().url(),
    events: z.array(z.enum(["job.created", "job.completed", "job.failed", "watcher.ingested"])).min(1),
    active: z.boolean().default(true),
  },
  async (input) =>
    asTextResult(await call("/api/v1/webhooks", { method: "POST", body: input })),
);

server.tool(
  "webhooks_update",
  "Update a webhook. Pass any of active, url, or events to change them. To rotate the signing secret, use webhooks_rotate_secret.",
  {
    id: z.string(),
    active: z.boolean().optional(),
    url: z.string().url().optional(),
    events: z.array(z.enum(["job.created", "job.completed", "job.failed", "watcher.ingested"])).min(1).optional(),
  },
  async ({ id, ...rest }) =>
    asTextResult(await call(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "PATCH", body: rest })),
);

server.tool(
  "webhooks_delete",
  "Delete a webhook. Cancels all pending retry deliveries.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(await call(`/api/v1/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" })),
);

server.tool(
  "webhooks_test",
  "Fire a synthetic signed delivery to a webhook so you can verify URL, signature, and firewall before relying on a real job.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(await call(`/api/v1/webhooks/${encodeURIComponent(id)}/test`, { method: "POST", body: {} })),
);

server.tool(
  "webhooks_rotate_secret",
  "Rotate the HMAC signing secret for a webhook. Returns the new plaintext secret once; the previous secret is immediately invalidated. Update the receiver before relying on the new secret.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(await call(`/api/v1/webhooks/${encodeURIComponent(id)}/rotate-secret`, { method: "POST", body: {} })),
);

server.tool(
  "webhooks_deliveries",
  "List recent delivery attempts for a webhook. Each row has the event, statusCode, ok, attempt, status (pending/delivered/exhausted), and durationMs. Useful for debugging why a receiver is rejecting payloads.",
  {
    id: z.string(),
    limit: z.number().int().min(1).max(200).default(20),
  },
  async ({ id, limit }) =>
    asTextResult(await call(`/api/v1/webhooks/${encodeURIComponent(id)}/deliveries?limit=${limit}`)),
);

server.tool(
  "watchers_list",
  "List the user's cloud watched folders (Dropbox / Google Drive / OneDrive). Each entry surfaces provider, name, folderPath, model, intervalSeconds, active, lastPolledAt, lastError, ingestedCount.",
  {},
  async () => asTextResult(await call("/api/v1/integrations/watchers")),
);

server.tool(
  "watchers_create",
  "Create a watched folder. Extracto sweeps it on the chosen interval and submits any new file (pdf, png, jpg, webp; up to 64 MiB) to the OCR queue using the chosen model. Folder syntax: Dropbox uses /Inbox-style paths, Google Drive and OneDrive use folder ids (or 'root'), local uses a sub-folder name under LOCAL_WATCH_ROOT/<userId>/.",
  {
    provider: z.enum(["dropbox", "google_drive", "onedrive", "local"]),
    name: z.string().describe("Display name; unique per provider per user."),
    folderPath: z.string().default(""),
    model: z.string(),
    intervalSeconds: z.number().int().min(60).max(86400).default(300),
    active: z.boolean().default(true),
    templateId: z.string().nullable().default(null),
    autoKbExport: z.boolean().default(false),
    autoS3Export: z.boolean().default(false),
  },
  async (input) =>
    asTextResult(
      await call("/api/v1/integrations/watchers", { method: "POST", body: input }),
    ),
);

server.tool(
  "watchers_update",
  "Update one watched-folder. Pass only the fields to change. Re-activating clears any auto-pause failure counter.",
  {
    id: z.string(),
    name: z.string().optional(),
    folderPath: z.string().optional(),
    model: z.string().optional(),
    intervalSeconds: z.number().int().min(60).max(86400).optional(),
    active: z.boolean().optional(),
    templateId: z.string().nullable().optional(),
    autoKbExport: z.boolean().optional(),
    autoS3Export: z.boolean().optional(),
  },
  async ({ id, ...rest }) =>
    asTextResult(
      await call(`/api/v1/integrations/watchers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: rest,
      }),
    ),
);

server.tool(
  "watchers_delete",
  "Delete a cloud watched folder. Already-ingested file fingerprints are removed too; if the same file appears again it will be re-ingested.",
  { id: z.string() },
  async ({ id }) =>
    asTextResult(
      await call(`/api/v1/integrations/watchers/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ),
);

const transport = new StdioServerTransport();
await server.connect(transport);
