// Shared types for the knowledge-base export pipeline.
// All KB modules consume these — no Prisma, no Next.js, no I/O imports
// belong here.

export type ChunkingStrategy = "fixed" | "sentence" | "paragraph";

export interface ChunkingOptions {
  strategy: ChunkingStrategy;
  /** Max characters per chunk (after which we cut, regardless of strategy boundaries). */
  maxChunkSize: number;
  /** For "fixed" strategy: char overlap between adjacent chunks. */
  overlap?: number;
  /** For "sentence" / "paragraph": minimum chunk size before merging onward. */
  minChunkSize?: number;
}

export interface ChunkMetadata {
  /** ID of the OCR job this chunk came from. */
  jobId: string;
  /** Original uploaded file name. */
  fileName: string;
  /** 1-indexed page number, when the source has page boundaries. */
  pageNumber?: number;
  /** 0-indexed position of this chunk within the document. */
  chunkIndex: number;
  /** Total number of chunks for the parent document (NOT per-page). */
  chunkOf: number;
  /** Chunking strategy that produced this chunk. */
  strategy: ChunkingStrategy;
  /** ISO-639-1 language code of the source text, when known. */
  language?: string;
  /** ISO-8601 timestamp of when the source was extracted. */
  extractedAt: string;
  /** OCR / inference model that produced the source text. */
  model?: string;
  /** Character offset of the chunk's first char within the source document. */
  sourceOffset?: number;
  /** Character offset (exclusive) of the chunk's last char within the source. */
  sourceEndOffset?: number;
  /** SHA-256 hex digest of the chunk text — enables idempotent upserts. */
  contentHash?: string;
}

export interface Chunk {
  text: string;
  metadata: ChunkMetadata;
}

import type { ProviderKind } from "@/lib/api-types";

// Embedding only supports the chat-completions-style providers (Mistral
// has no embeddings endpoint at this time). Derive from ProviderKind so
// adding a new provider doesn't silently leave EmbeddingProviderKind
// out of sync.
export type EmbeddingProviderKind = Extract<ProviderKind, "ollama" | "openrouter" | "openai_compat">;

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderKind;
  apiEndpoint: string;
  /** Required for openrouter and (in practice) openai_compat. Ollama leaves it unset. */
  apiKey?: string;
  model: string;
  /** Vector dimensionality for the model — needed at collection-create time
      to validate compatibility with the chosen vector store. */
  dimensions?: number;
}

/** Adapter contract for a backing vector store (Chroma, Qdrant, etc.). */
export interface VectorStoreAdapter {
  /** Push or update a batch of chunks. Implementations may batch internally. */
  upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void>;
  /**
   * True iff the collection exists. Implementations typically auto-create on
   * upsert, so the only legitimate use of this method is pre-flight UX
   * (warn before writing to a name that's already taken, or report whether
   * a previous export landed).
   */
  collectionExists(name: string): Promise<boolean>;
}
