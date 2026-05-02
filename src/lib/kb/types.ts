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
  jobId: string;
  fileName: string;
  pageNumber?: number;
  chunkIndex: number;
  chunkOf: number;
  strategy: ChunkingStrategy;
  language?: string;
  extractedAt: string;
  model?: string;
}

export interface Chunk {
  text: string;
  metadata: ChunkMetadata;
}

export type EmbeddingProviderKind = "ollama" | "openrouter" | "openai_compat";

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderKind;
  apiEndpoint: string;
  apiKey?: string;
  model: string;
}

/** Adapter contract for a backing vector store (Chroma, Qdrant, etc.). */
export interface VectorStoreAdapter {
  /** Push or update a batch of chunks. Implementations may batch internally. */
  upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void>;
  /** True iff the collection exists; implementations typically auto-create on upsert. */
  collectionExists(name: string): Promise<boolean>;
}
