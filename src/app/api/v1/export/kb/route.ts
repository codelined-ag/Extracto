// POST /api/v1/export/kb — export an OCR job's extracted text to a vector store.
//
// Body shape:
//   {
//     jobId: string,
//     collectionName: string,
//     vectorStore: { kind: "chroma", baseUrl, apiKey?, dimensions? },
//     embedding:   { provider: ProviderKind, apiEndpoint, apiKey?, model, dimensions? },
//     chunking:    { strategy: "fixed"|"sentence"|"paragraph", maxChunkSize,
//                    overlap?, minChunkSize? }
//   }
//
// Returns: { jobId, collectionName, chunkCount, embeddingDimensions }
//
// Auth: bearer token with `kb:write` scope. The action is a write to an
// external vector store (egress with user-supplied URL + key), so it lives
// behind a write scope distinct from the OCR-read surface. The feature is
// also gated by KB_EXPORT_ENABLED at the env level so operators opt in.

import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { isKbExportEnabled } from "@/lib/kb/feature-flag";
import { runKbExport } from "@/lib/kb/export";
import { ChromaAdapter } from "@/lib/kb/stores/chroma";
import { QdrantAdapter } from "@/lib/kb/stores/qdrant";
import { WeaviateAdapter } from "@/lib/kb/stores/weaviate";
import { MilvusAdapter } from "@/lib/kb/stores/milvus";
import { OpenSearchAdapter } from "@/lib/kb/stores/opensearch";
import { PineconeAdapter } from "@/lib/kb/stores/pinecone";
import type {
  ChunkingOptions,
  ChunkingStrategy,
  EmbeddingProviderConfig,
  EmbeddingProviderKind,
  VectorStoreAdapter,
} from "@/lib/kb/types";
import { enforceProviderEndpointPolicy, enforceVectorStoreEndpointPolicy } from "@/lib/ocr/endpoint-policy";
import {
  getDefaultOpenAICompatApiUrl,
  getDefaultOpenRouterApiUrl,
  OLLAMA_DEFAULT_HOST,
} from "@/lib/ocr/provider-config";

function getEmbeddingProviderFallback(provider: EmbeddingProviderKind): string {
  if (provider === "openrouter") return getDefaultOpenRouterApiUrl();
  if (provider === "openai_compat") return getDefaultOpenAICompatApiUrl();
  return OLLAMA_DEFAULT_HOST;
}

const VALID_STRATEGIES: readonly ChunkingStrategy[] = [
  "fixed",
  "sentence",
  "paragraph",
  "hierarchical",
  "semantic",
];
const VALID_PROVIDERS: readonly EmbeddingProviderKind[] = ["ollama", "openrouter", "openai_compat"];
const VALID_STORES = ["chroma", "qdrant", "weaviate", "milvus", "opensearch", "pinecone"] as const;
type StoreKind = (typeof VALID_STORES)[number];

interface KbExportRequest extends Record<string, unknown> {
  jobId?: unknown;
  collectionName?: unknown;
  vectorStore?: unknown;
  embedding?: unknown;
  chunking?: unknown;
  embeddingConcurrency?: unknown;
}

export const POST = withMutationAuth("kb:write", async (request: NextRequest, { auth }) => {
  if (!isKbExportEnabled()) {
    throw new ApiRouteError(
      "KB export is disabled on this instance.",
      503,
    );
  }

  const body = await parseJsonBody<KbExportRequest>(request);
  const jobId = stringField(body.jobId, "jobId");
  const collectionName = stringField(body.collectionName, "collectionName");
  const chunking = parseChunking(body.chunking);
  const embedding = parseEmbedding(body.embedding);
  const store = parseVectorStore(body.vectorStore);
  const embeddingConcurrency = parseEmbeddingConcurrency(body.embeddingConcurrency);

  const job = await db.ocrJob.findFirst({
    where: { id: jobId, userId: auth.userId },
    select: {
      id: true,
      fileName: true,
      extractedText: true,
      model: true,
      completedAt: true,
      createdAt: true,
      metadata: true,
    },
  });
  if (!job) {
    throw new ApiRouteError("Job not found", 404);
  }
  if (!job.extractedText || !job.extractedText.trim()) {
    throw new ApiRouteError("Job has no extracted text to export", 400);
  }

  const language = pickLanguage(job.metadata);
  const result = await runKbExport({
    jobId: job.id,
    fileName: job.fileName,
    extractedText: job.extractedText,
    extractedAt: (job.completedAt ?? job.createdAt).toISOString(),
    sourceModel: job.model ?? undefined,
    language,
    chunking,
    embedding,
    embeddingConcurrency,
    store,
    collectionName,
  });

  return NextResponse.json(result);
});

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiRouteError(`${label} (string) is required`, 400);
  }
  return value.trim();
}

function parseChunking(raw: unknown): ChunkingOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiRouteError("chunking (object) is required", 400);
  }
  const r = raw as Record<string, unknown>;
  const rawStrategy = r.strategy;
  if (typeof rawStrategy !== "string" || !VALID_STRATEGIES.includes(rawStrategy as ChunkingStrategy)) {
    throw new ApiRouteError(
      `chunking.strategy must be one of: ${VALID_STRATEGIES.join(", ")}`,
      400,
    );
  }
  const strategy = rawStrategy as ChunkingStrategy;
  const maxChunkSize = typeof r.maxChunkSize === "number" ? r.maxChunkSize : 0;
  if (!Number.isInteger(maxChunkSize) || maxChunkSize <= 0 || maxChunkSize > 10_000) {
    throw new ApiRouteError("chunking.maxChunkSize must be an integer in 1..10000", 400);
  }
  const overlap = typeof r.overlap === "number" ? r.overlap : undefined;
  if (overlap != null && (!Number.isInteger(overlap) || overlap < 0 || overlap >= maxChunkSize)) {
    throw new ApiRouteError("chunking.overlap must be an integer in 0..(maxChunkSize-1)", 400);
  }
  const minChunkSize = typeof r.minChunkSize === "number" ? r.minChunkSize : undefined;
  if (
    minChunkSize != null &&
    (!Number.isInteger(minChunkSize) || minChunkSize < 0 || minChunkSize > maxChunkSize)
  ) {
    throw new ApiRouteError(
      "chunking.minChunkSize must be an integer in 0..maxChunkSize",
      400,
    );
  }
  const breakpointPercentile = typeof r.breakpointPercentile === "number"
    ? r.breakpointPercentile
    : undefined;
  if (
    breakpointPercentile != null &&
    (!Number.isFinite(breakpointPercentile) || breakpointPercentile < 0 || breakpointPercentile > 100)
  ) {
    throw new ApiRouteError("chunking.breakpointPercentile must be a number in 0..100", 400);
  }
  const maxHeadingDepth = typeof r.maxHeadingDepth === "number" ? r.maxHeadingDepth : undefined;
  if (
    maxHeadingDepth != null &&
    (!Number.isInteger(maxHeadingDepth) || maxHeadingDepth < 1 || maxHeadingDepth > 6)
  ) {
    throw new ApiRouteError("chunking.maxHeadingDepth must be an integer in 1..6", 400);
  }
  return { strategy, maxChunkSize, overlap, minChunkSize, breakpointPercentile, maxHeadingDepth };
}

function parseEmbeddingConcurrency(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new ApiRouteError("embeddingConcurrency must be a number between 1 and 16", 400);
  }
  const t = Math.trunc(raw);
  if (t < 1 || t > 16) {
    throw new ApiRouteError("embeddingConcurrency must be between 1 and 16", 400);
  }
  return t;
}

function parseEmbedding(raw: unknown): EmbeddingProviderConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiRouteError("embedding (object) is required", 400);
  }
  const r = raw as Record<string, unknown>;
  const rawProvider = r.provider;
  if (typeof rawProvider !== "string" || !VALID_PROVIDERS.includes(rawProvider as EmbeddingProviderKind)) {
    throw new ApiRouteError(
      `embedding.provider must be one of: ${VALID_PROVIDERS.join(", ")}`,
      400,
    );
  }
  const provider = rawProvider as EmbeddingProviderKind;
  const rawEndpoint = stringField(r.apiEndpoint, "embedding.apiEndpoint");
  const apiEndpoint = enforceProviderEndpointPolicy(
    provider,
    rawEndpoint,
    getEmbeddingProviderFallback(provider),
  );
  const model = stringField(r.model, "embedding.model");
  const apiKey = typeof r.apiKey === "string" ? r.apiKey : undefined;
  const dimensions = typeof r.dimensions === "number" && Number.isInteger(r.dimensions) && r.dimensions > 0
    ? r.dimensions
    : undefined;
  return { provider, apiEndpoint, model, apiKey, dimensions };
}

function parseVectorStore(raw: unknown): VectorStoreAdapter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiRouteError("vectorStore (object) is required", 400);
  }
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== "string" || !(VALID_STORES as readonly string[]).includes(kind)) {
    throw new ApiRouteError(
      `vectorStore.kind must be one of: ${VALID_STORES.join(", ")} (got ${String(kind)})`,
      400,
    );
  }
  const rawBaseUrl = stringField(r.baseUrl, "vectorStore.baseUrl");
  const baseUrl = enforceVectorStoreEndpointPolicy(rawBaseUrl);
  const apiKey = typeof r.apiKey === "string" ? r.apiKey : undefined;
  const dimensions = typeof r.dimensions === "number" && Number.isInteger(r.dimensions) && r.dimensions > 0
    ? r.dimensions
    : undefined;
  const k = kind as StoreKind;
  if (k === "qdrant") return new QdrantAdapter({ baseUrl, apiKey, dimensions });
  if (k === "weaviate") return new WeaviateAdapter({ baseUrl, apiKey, dimensions });
  if (k === "milvus") return new MilvusAdapter({ baseUrl, apiKey, dimensions });
  if (k === "opensearch") return new OpenSearchAdapter({ baseUrl, apiKey, dimensions });
  if (k === "pinecone") {
    if (!apiKey) {
      throw new ApiRouteError("vectorStore.apiKey is required for Pinecone", 400);
    }
    return new PineconeAdapter({ baseUrl, apiKey, dimensions });
  }
  return new ChromaAdapter({ baseUrl, apiKey, dimensions });
}

function pickLanguage(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const lang = (metadata as Record<string, unknown>).language;
  return typeof lang === "string" && lang.length <= 8 ? lang : undefined;
}
