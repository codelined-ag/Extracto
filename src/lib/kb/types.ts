export type ChunkingStrategy =
  | "fixed"
  | "sentence"
  | "paragraph"
  | "hierarchical"
  | "semantic";

export interface ChunkingOptions {
  strategy: ChunkingStrategy;
  /** Max characters per chunk (after which we cut, regardless of strategy boundaries). */
  maxChunkSize: number;
  /** For "fixed" strategy: char overlap between adjacent chunks. */
  overlap?: number;
  /** For "sentence" / "paragraph" / "hierarchical": minimum chunk size before merging onward. */
  minChunkSize?: number;
  /**
   * For "semantic": percentile (0-100) of pairwise cosine distances between
   * consecutive sentence embeddings; distances above this percentile become
   * chunk boundaries. Higher = fewer, larger chunks. Default 95.
   */
  breakpointPercentile?: number;
  /**
   * For "hierarchical": maximum heading depth (1..6) to honor when building
   * the heading breadcrumb path. Headings deeper than this are flattened
   * into the deepest in-bounds parent. Default 6 (honor all).
   */
  maxHeadingDepth?: number;
}

/**
 * Strategy-output shape: text plus any strategy-specific metadata that the
 * orchestrator merges into the final ChunkMetadata. Keeping the extras
 * narrowly typed prevents strategies from sneaking arbitrary fields into
 * the persisted vector-store record.
 */
export interface ChunkPiece {
  text: string;
  extras?: {
    /**
     * Hierarchical: ordered list of heading texts from the outermost ancestor
     * down to the chunk's parent leaf. NOTE: when ATX heading levels are
     * skipped (e.g. an H1 followed directly by an H3), `headingPath.length`
     * will be smaller than `headingLevel`. Consumers must NOT index by level —
     * always treat the path as a logical breadcrumb of in-document headings.
     */
    headingPath?: string[];
    /** Hierarchical: deepest heading level (1..6) the chunk lives under, or 0 if none. */
    headingLevel?: number;
  };
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
  /**
   * Hierarchical: ordered breadcrumb of heading texts (outermost → parent leaf).
   * `headingPath.length` may be less than `headingLevel` when ATX levels are
   * skipped. Treat as a logical breadcrumb, not as a level-indexed array.
   */
  headingPath?: string[];
  /** Hierarchical: deepest heading level (1..6), or 0 if no heading context. */
  headingLevel?: number;
}

export interface Chunk {
  text: string;
  metadata: ChunkMetadata;
}

import type { ProviderKind } from "@/lib/api-types";

export type EmbeddingProviderKind = Extract<ProviderKind, "ollama" | "openrouter" | "openai_compat">;

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderKind;
  apiEndpoint: string;
  apiKey?: string;
  model: string;
  dimensions?: number;
}

export interface VectorStoreAdapter {
  upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void>;
  collectionExists(name: string): Promise<boolean>;
}
