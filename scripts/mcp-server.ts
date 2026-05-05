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
            })
            .partial()
            .optional(),
          postProcessing: z
            .object({
              enabled: z.boolean().optional(),
              instruction: z.string().optional(),
              outputFormat: z.enum(["markdown", "json"]).optional(),
              model: z.string().optional(),
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
  "Render a COMPLETED job's text into a downloadable file. Supported formats: md (markdown), json (full structured result), txt (plain text), html, docx, rtf, csv (markdown tables, falls back to one-line dump for prose), xlsx (each markdown table is a separate sheet, prose dumps to a single sheet). Returns the file as base64.",
  {
    jobId: z.string(),
    format: z.enum(["md", "json", "txt", "html", "docx", "rtf", "csv", "xlsx"]),
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

const transport = new StdioServerTransport();
await server.connect(transport);
