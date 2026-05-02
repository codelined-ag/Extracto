// KB export orchestrator: chunk -> embed -> upsert.
//
// Pure(-ish) — only depends on the lib/kb modules and a couple of injectable
// dependencies (embedTexts, vector store adapter). The /api/v1/export/kb
// route handler wires the real fetch + ChromaAdapter into this function.

import { createHash } from "node:crypto";

import { chunk as chunkText } from "@/lib/kb/chunking";
import { embedTexts } from "@/lib/kb/embedding";
import type {
  Chunk,
  ChunkingOptions,
  EmbeddingProviderConfig,
  VectorStoreAdapter,
} from "@/lib/kb/types";

export interface KbExportInput {
  jobId: string;
  fileName: string;
  /** OCR job's final extracted text (markdown). */
  extractedText: string;
  /** Chunking strategy + sizing. */
  chunking: ChunkingOptions;
  /** ISO-8601 timestamp of when the source was extracted. */
  extractedAt: string;
  /** OCR / inference model that produced the source text. */
  sourceModel?: string;
  /** Document language code, when known. */
  language?: string;
  /** Embedding provider config — apiEndpoint, model, optional key. */
  embedding: EmbeddingProviderConfig;
  /** Where to upsert the chunks. */
  store: VectorStoreAdapter;
  collectionName: string;
}

export interface KbExportResult {
  jobId: string;
  collectionName: string;
  chunkCount: number;
  embeddingDimensions: number | null;
}

/**
 * Run a full KB export end-to-end. Splits the source text per the chunking
 * strategy, computes embeddings in a single batch, and upserts via the
 * supplied vector store adapter. Throws on any embedding or store failure;
 * the caller is responsible for wrapping in a try/catch and updating
 * persistent KbExport status.
 */
export async function runKbExport(input: KbExportInput): Promise<KbExportResult> {
  const pieces = chunkText(input.extractedText, input.chunking);
  if (pieces.length === 0) {
    return {
      jobId: input.jobId,
      collectionName: input.collectionName,
      chunkCount: 0,
      embeddingDimensions: null,
    };
  }

  const chunks: Chunk[] = pieces.map((text, idx) => buildChunk(input, text, idx, pieces.length));

  const embeddings = await embedTexts(
    chunks.map((c) => c.text),
    input.embedding,
  );
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding provider returned ${embeddings.length} vectors for ${chunks.length} chunks`,
    );
  }

  const enriched = chunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  await input.store.upsert(enriched, input.collectionName);

  return {
    jobId: input.jobId,
    collectionName: input.collectionName,
    chunkCount: chunks.length,
    embeddingDimensions: embeddings[0]?.length ?? null,
  };
}

function buildChunk(
  input: KbExportInput,
  text: string,
  chunkIndex: number,
  chunkOf: number,
): Chunk {
  const contentHash = createHash("sha256").update(text).digest("hex");
  return {
    text,
    metadata: {
      jobId: input.jobId,
      fileName: input.fileName,
      chunkIndex,
      chunkOf,
      strategy: input.chunking.strategy,
      extractedAt: input.extractedAt,
      ...(input.sourceModel ? { model: input.sourceModel } : {}),
      ...(input.language ? { language: input.language } : {}),
      contentHash,
    },
  };
}
