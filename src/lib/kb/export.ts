import { createHash } from "node:crypto";

import { chunk as chunkText } from "@/lib/kb/chunking";
import { chunkSemantic } from "@/lib/kb/semantic-chunking";
import { embedTexts } from "@/lib/kb/embedding";
import type {
  Chunk,
  ChunkPiece,
  ChunkingOptions,
  EmbeddingProviderConfig,
  VectorStoreAdapter,
} from "@/lib/kb/types";

export interface KbExportProgress {
  phase: "chunking" | "embedding" | "upserting";
  embeddingDone?: number;
  embeddingTotal?: number;
  chunkCount?: number;
}

export interface KbExportInput {
  jobId: string;
  fileName: string;
  extractedText: string;
  chunking: ChunkingOptions;
  extractedAt: string;
  sourceModel?: string;
  language?: string;
  embedding: EmbeddingProviderConfig;
  embeddingConcurrency?: number;
  store: VectorStoreAdapter;
  collectionName: string;
  onProgress?: (event: KbExportProgress) => void;
}

export interface KbExportResult {
  jobId: string;
  collectionName: string;
  chunkCount: number;
  embeddingDimensions: number | null;
}

export async function runKbExport(input: KbExportInput): Promise<KbExportResult> {
  input.onProgress?.({ phase: "chunking" });
  const pieces = await chunkForStrategy(input);
  if (pieces.length === 0) {
    return {
      jobId: input.jobId,
      collectionName: input.collectionName,
      chunkCount: 0,
      embeddingDimensions: null,
    };
  }

  const chunks: Chunk[] = pieces.map((piece, idx) =>
    buildChunk(input, piece, idx, pieces.length),
  );

  input.onProgress?.({
    phase: "embedding",
    embeddingDone: 0,
    embeddingTotal: chunks.length,
    chunkCount: chunks.length,
  });

  const embeddings = await embedTexts(
    chunks.map((c) => c.text),
    input.embedding,
    fetch,
    {
      concurrency: input.embeddingConcurrency,
      onBatch: input.onProgress
        ? ({ done, total }) =>
            input.onProgress!({
              phase: "embedding",
              embeddingDone: done,
              embeddingTotal: total,
              chunkCount: chunks.length,
            })
        : undefined,
    },
  );
  if (embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding provider returned ${embeddings.length} vectors for ${chunks.length} chunks`,
    );
  }

  input.onProgress?.({
    phase: "upserting",
    embeddingDone: chunks.length,
    embeddingTotal: chunks.length,
    chunkCount: chunks.length,
  });

  const enriched = chunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  await input.store.upsert(enriched, input.collectionName);

  return {
    jobId: input.jobId,
    collectionName: input.collectionName,
    chunkCount: chunks.length,
    embeddingDimensions: embeddings[0]?.length ?? null,
  };
}

async function chunkForStrategy(input: KbExportInput): Promise<ChunkPiece[]> {
  if (input.chunking.strategy === "semantic") {
    return chunkSemantic(input.extractedText, input.chunking, input.embedding);
  }
  return chunkText(input.extractedText, input.chunking);
}

function buildChunk(
  input: KbExportInput,
  piece: ChunkPiece,
  chunkIndex: number,
  chunkOf: number,
): Chunk {
  const contentHash = createHash("sha256").update(piece.text).digest("hex");
  const headingPath = piece.extras?.headingPath;
  const headingLevel = piece.extras?.headingLevel;
  return {
    text: piece.text,
    metadata: {
      jobId: input.jobId,
      fileName: input.fileName,
      chunkIndex,
      chunkOf,
      strategy: input.chunking.strategy,
      extractedAt: input.extractedAt,
      ...(input.sourceModel ? { model: input.sourceModel } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(headingPath && headingPath.length > 0 ? { headingPath } : {}),
      ...(typeof headingLevel === "number" ? { headingLevel } : {}),
      contentHash,
    },
  };
}
