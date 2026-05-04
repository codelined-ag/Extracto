// Per-user KB export defaults. Mirrors lib/ocr/settings-store.ts: a JSON
// file per user under <data-root>/kb-defaults/<userId>.json, in-memory
// cache for hot reads. Stored separately from api-settings.json because
// these defaults are aspirational (the user may never run an export) and
// because the embedding/store credentials can differ from the OCR
// provider credentials.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChunkingOptions,
  ChunkingStrategy,
  EmbeddingProviderConfig,
  EmbeddingProviderKind,
} from "@/lib/kb/types";
import {
  enforceProviderEndpointPolicy,
  enforceVectorStoreEndpointPolicy,
} from "@/lib/ocr/endpoint-policy";

export type VectorStoreKind =
  | "chroma"
  | "qdrant"
  | "weaviate"
  | "milvus"
  | "opensearch"
  | "pinecone"
  | "typesense";

export interface VectorStoreDefaults {
  kind: VectorStoreKind;
  baseUrl: string;
  apiKey: string;
  dimensions?: number;
}

const VALID_STORE_KINDS: ReadonlySet<VectorStoreKind> = new Set([
  "chroma",
  "qdrant",
  "weaviate",
  "milvus",
  "opensearch",
  "pinecone",
  "typesense",
]);

const DEFAULT_BASE_URL_BY_KIND: Record<VectorStoreKind, string> = {
  chroma: "http://127.0.0.1:8000",
  qdrant: "http://127.0.0.1:6333",
  weaviate: "http://127.0.0.1:8080",
  milvus: "http://127.0.0.1:9091",
  opensearch: "http://127.0.0.1:9200",
  pinecone: "",
  typesense: "http://127.0.0.1:8108",
};

export interface KbDefaults {
  embedding: EmbeddingProviderConfig;
  chunking: ChunkingOptions;
  vectorStore: VectorStoreDefaults;
  /** Default collection name template — `{jobId}` and `{fileName}` are substituted at export time. */
  collectionNameTemplate: string;
  /** How many embedding-batch requests to fan out in parallel during a KB export. Stored as 1..16; missing/<=0 falls back to 1 (single batch). */
  embeddingConcurrency: number;
}

export type ClientKbDefaults = Omit<KbDefaults, "embedding" | "vectorStore"> & {
  embedding: Omit<EmbeddingProviderConfig, "apiKey"> & { hasApiKey: boolean };
  vectorStore: Omit<VectorStoreDefaults, "apiKey"> & { hasApiKey: boolean };
  embeddingConcurrency: number;
};

const VALID_STRATEGIES: ReadonlySet<ChunkingStrategy> = new Set([
  "fixed",
  "sentence",
  "paragraph",
  "hierarchical",
  "semantic",
]);
const VALID_PROVIDERS: ReadonlySet<EmbeddingProviderKind> = new Set(["ollama", "openrouter", "openai_compat"]);

const DEFAULTS: KbDefaults = {
  embedding: {
    provider: "ollama",
    apiEndpoint: "http://127.0.0.1:11434",
    apiKey: "",
    model: "nomic-embed-text",
    dimensions: 768,
  },
  chunking: {
    strategy: "paragraph",
    maxChunkSize: 1200,
    overlap: 100,
    minChunkSize: 200,
    breakpointPercentile: 95,
    maxHeadingDepth: 6,
  },
  vectorStore: {
    kind: "chroma",
    baseUrl: "http://127.0.0.1:8000",
    apiKey: "",
    dimensions: 768,
  },
  collectionNameTemplate: "extracto-{jobId}",
  embeddingConcurrency: 1,
};

const cache = new Map<string, KbDefaults>();

function getDataRoot(): string {
  const envDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!envDatabaseUrl?.startsWith("file:")) return process.cwd();
  return path.dirname(envDatabaseUrl.replace(/^file:/u, ""));
}

function getDefaultsDir(): string {
  return path.join(getDataRoot(), "kb-defaults");
}

function sanitizeUserId(userId: string): string {
  return userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getDefaultsPath(userId: string): string {
  return path.join(getDefaultsDir(), `${sanitizeUserId(userId)}.json`);
}

function intOrUndef(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v)) return undefined;
  if (v < min || v > max) return undefined;
  return v;
}

function floatInRange(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < min || v > max) return undefined;
  return v;
}

function normalize(raw: Partial<KbDefaults>): KbDefaults {
  const eRaw = (raw.embedding ?? {}) as Partial<EmbeddingProviderConfig>;
  const cRaw = (raw.chunking ?? {}) as Partial<ChunkingOptions>;
  const sRaw = (raw.vectorStore ?? {}) as Partial<VectorStoreDefaults>;

  const provider: EmbeddingProviderKind =
    typeof eRaw.provider === "string" && VALID_PROVIDERS.has(eRaw.provider as EmbeddingProviderKind)
      ? (eRaw.provider as EmbeddingProviderKind)
      : DEFAULTS.embedding.provider;
  const strategy: ChunkingStrategy =
    typeof cRaw.strategy === "string" && VALID_STRATEGIES.has(cRaw.strategy as ChunkingStrategy)
      ? (cRaw.strategy as ChunkingStrategy)
      : DEFAULTS.chunking.strategy;

  const maxChunkSize = intOrUndef(cRaw.maxChunkSize, 1, 10_000) ?? DEFAULTS.chunking.maxChunkSize;
  const overlap = intOrUndef(cRaw.overlap, 0, maxChunkSize - 1);
  const minChunkSize = intOrUndef(cRaw.minChunkSize, 0, maxChunkSize);
  const breakpointPercentile =
    floatInRange(cRaw.breakpointPercentile, 0, 100) ?? DEFAULTS.chunking.breakpointPercentile;
  const maxHeadingDepth =
    intOrUndef(cRaw.maxHeadingDepth, 1, 6) ?? DEFAULTS.chunking.maxHeadingDepth;

  const storeKind: VectorStoreKind = typeof sRaw.kind === "string" && VALID_STORE_KINDS.has(sRaw.kind as VectorStoreKind)
    ? (sRaw.kind as VectorStoreKind)
    : DEFAULTS.vectorStore.kind;

  return {
    embedding: {
      provider,
      apiEndpoint: typeof eRaw.apiEndpoint === "string" && eRaw.apiEndpoint.trim()
        ? eRaw.apiEndpoint.trim()
        : DEFAULTS.embedding.apiEndpoint,
      apiKey: typeof eRaw.apiKey === "string" ? eRaw.apiKey : "",
      model: typeof eRaw.model === "string" && eRaw.model.trim() ? eRaw.model.trim() : DEFAULTS.embedding.model,
      dimensions: intOrUndef(eRaw.dimensions, 1, 32_768) ?? DEFAULTS.embedding.dimensions,
    },
    chunking: { strategy, maxChunkSize, overlap, minChunkSize, breakpointPercentile, maxHeadingDepth },
    vectorStore: {
      kind: storeKind,
      baseUrl: typeof sRaw.baseUrl === "string" && sRaw.baseUrl.trim()
        ? sRaw.baseUrl.trim()
        : DEFAULT_BASE_URL_BY_KIND[storeKind],
      apiKey: typeof sRaw.apiKey === "string" ? sRaw.apiKey : "",
      dimensions: intOrUndef(sRaw.dimensions, 1, 32_768) ?? DEFAULTS.vectorStore.dimensions,
    },
    collectionNameTemplate:
      typeof raw.collectionNameTemplate === "string" && raw.collectionNameTemplate.trim()
        ? raw.collectionNameTemplate.trim().slice(0, 200)
        : DEFAULTS.collectionNameTemplate,
    embeddingConcurrency: intOrUndef(raw.embeddingConcurrency, 1, 16) ?? DEFAULTS.embeddingConcurrency,
  };
}

export function defaultBaseUrlForStoreKind(kind: VectorStoreKind): string {
  return DEFAULT_BASE_URL_BY_KIND[kind];
}

export async function getKbDefaults(userId: string): Promise<KbDefaults> {
  const safe = sanitizeUserId(userId);
  const cached = cache.get(safe);
  if (cached) return structuredClone(cached);

  try {
    const stored = await readFile(getDefaultsPath(safe), "utf8");
    const parsed = JSON.parse(stored) as Partial<KbDefaults>;
    const normalized = normalize(parsed);
    cache.set(safe, normalized);
    return structuredClone(normalized);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[kb-defaults] read failure:", err);
    }
    const normalized = normalize(DEFAULTS);
    cache.set(safe, normalized);
    return structuredClone(normalized);
  }
}

export interface SaveKbDefaultsInput extends Record<string, unknown> {
  embedding?: Partial<EmbeddingProviderConfig> & { replaceApiKey?: boolean };
  chunking?: Partial<ChunkingOptions>;
  vectorStore?: Partial<VectorStoreDefaults> & { replaceApiKey?: boolean };
  collectionNameTemplate?: string;
  embeddingConcurrency?: number;
}

export async function saveKbDefaults(
  userId: string,
  input: SaveKbDefaultsInput,
): Promise<KbDefaults> {
  const safe = sanitizeUserId(userId);
  const current = await getKbDefaults(safe);

  const proposedEmbeddingEndpoint = input.embedding?.apiEndpoint ?? current.embedding.apiEndpoint;
  const proposedEmbeddingProvider = input.embedding?.provider ?? current.embedding.provider;
  enforceProviderEndpointPolicy(
    proposedEmbeddingProvider,
    proposedEmbeddingEndpoint,
    proposedEmbeddingEndpoint,
  );
  const proposedStoreBaseUrl = input.vectorStore?.baseUrl ?? current.vectorStore.baseUrl;
  enforceVectorStoreEndpointPolicy(proposedStoreBaseUrl);

  const merged: KbDefaults = {
    embedding: {
      ...current.embedding,
      ...input.embedding,
      // apiKey only updates when explicitly told to replace — mirrors the
      // OCR settings convention so the UI can show "saved (hidden)".
      apiKey: input.embedding?.replaceApiKey
        ? (input.embedding.apiKey ?? "")
        : current.embedding.apiKey,
    },
    chunking: { ...current.chunking, ...input.chunking },
    vectorStore: {
      ...current.vectorStore,
      ...input.vectorStore,
      kind: (input.vectorStore?.kind && VALID_STORE_KINDS.has(input.vectorStore.kind))
        ? input.vectorStore.kind
        : current.vectorStore.kind,
      apiKey: input.vectorStore?.replaceApiKey
        ? (input.vectorStore.apiKey ?? "")
        : current.vectorStore.apiKey,
    },
    collectionNameTemplate: input.collectionNameTemplate ?? current.collectionNameTemplate,
    embeddingConcurrency: input.embeddingConcurrency ?? current.embeddingConcurrency,
  };

  const normalized = normalize(merged);
  await mkdir(getDefaultsDir(), { recursive: true });
  await writeFile(getDefaultsPath(safe), JSON.stringify(normalized, null, 2), "utf8");
  cache.set(safe, normalized);
  return structuredClone(normalized);
}

export function toClientKbDefaults(d: KbDefaults): ClientKbDefaults {
  const { apiKey: eKey, ...embeddingRest } = d.embedding;
  const { apiKey: sKey, ...storeRest } = d.vectorStore;
  return {
    embedding: { ...embeddingRest, hasApiKey: Boolean((eKey ?? "").trim()) },
    chunking: d.chunking,
    vectorStore: { ...storeRest, hasApiKey: Boolean((sKey ?? "").trim()) },
    collectionNameTemplate: d.collectionNameTemplate,
    embeddingConcurrency: d.embeddingConcurrency,
  };
}

export function renderCollectionName(template: string, jobId: string, fileName: string): string {
  // Sanitize per Chroma's collection-name rules: 3-512 chars, only
  // [a-zA-Z0-9._-], must start and end with alnum.
  const baseName = fileName.replace(/\.[^.]+$/u, "");
  const raw = template
    .replaceAll("{jobId}", jobId)
    .replaceAll("{fileName}", baseName);
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 512);
  // Pad to satisfy the 3-char minimum.
  return (cleaned + "-doc").slice(0, 512);
}
