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
  method?: "GET" | "POST" | "DELETE";
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
  "ocr_get",
  "Fetch a single OCR job (id, status, extractedText, structured result).",
  { jobId: z.string() },
  async ({ jobId }) => asTextResult(await call(`/api/jobs/${encodeURIComponent(jobId)}`)),
);

server.tool(
  "jobs_list",
  "List the caller's recent OCR jobs (newest first).",
  {
    limit: z.number().int().min(1).max(100).optional(),
    status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
  },
  async ({ limit, status }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (status) params.set("status", status);
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
      kind: z.enum(["chroma", "qdrant", "weaviate"]),
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
  },
  async (input) => asTextResult(await call("/api/v1/export/kb", { method: "POST", body: input })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
