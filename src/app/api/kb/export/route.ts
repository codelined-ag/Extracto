// /api/kb/export — browser-UI-internal KB export trigger. Session-cookie
// auth + CSRF-style origin check (via withMutationAuth). Reads the
// per-user persisted defaults to fill in any field the request omits;
// callers from the UI typically only send { jobId } and let the saved
// defaults supply everything else. Headless callers that want full
// per-call control should use /api/v1/export/kb with bearer auth.

import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { runKbExport } from "@/lib/kb/export";
import { isKbExportEnabled } from "@/lib/kb/feature-flag";
import { registerKbExport, updateKbExport } from "@/lib/kb/export-progress";
import { ChromaAdapter } from "@/lib/kb/stores/chroma";
import { QdrantAdapter } from "@/lib/kb/stores/qdrant";
import { WeaviateAdapter } from "@/lib/kb/stores/weaviate";
import type { VectorStoreAdapter } from "@/lib/kb/types";
import {
  getKbDefaults,
  renderCollectionName,
  type KbDefaults,
  type VectorStoreKind,
} from "@/lib/kb/defaults-store";

function buildVectorStore(kind: VectorStoreKind, baseUrl: string, apiKey: string | undefined, dimensions?: number): VectorStoreAdapter {
  if (kind === "qdrant") return new QdrantAdapter({ baseUrl, apiKey, dimensions });
  if (kind === "weaviate") return new WeaviateAdapter({ baseUrl, apiKey, dimensions });
  return new ChromaAdapter({ baseUrl, apiKey, dimensions });
}

interface KbExportBrowserRequest extends Record<string, unknown> {
  jobId?: unknown;
  collectionName?: unknown;
  embeddingConcurrency?: unknown;
  /** Optional one-shot overrides — merged on top of saved defaults. */
  overrides?: Partial<KbDefaults>;
}

export const POST = withMutationAuth("ocr:read", async (request: NextRequest, { auth }) => {
  if (!isKbExportEnabled()) {
    throw new ApiRouteError(
      "KB export is disabled on this instance.",
      503,
    );
  }

  const body = await parseJsonBody<KbExportBrowserRequest>(request);
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) {
    throw new ApiRouteError("jobId (string) is required", 400);
  }

  const defaults = await getKbDefaults(auth.userId);

  // Caller may override embedding/chunking/store on a per-call basis,
  // but apiKey overrides are forbidden — keys live on disk and are
  // injected here so the browser never has to round-trip them.
  const embedding = {
    ...defaults.embedding,
    ...(body.overrides?.embedding ?? {}),
    apiKey: defaults.embedding.apiKey,
  };
  const chunking = { ...defaults.chunking, ...(body.overrides?.chunking ?? {}) };
  const vectorStore = {
    ...defaults.vectorStore,
    ...(body.overrides?.vectorStore ?? {}),
    apiKey: defaults.vectorStore.apiKey,
  };

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

  const requestedName = typeof body.collectionName === "string" ? body.collectionName.trim() : "";
  const collectionName = requestedName
    ? requestedName
    : renderCollectionName(defaults.collectionNameTemplate, job.id, job.fileName);

  const rawConcurrency = body?.embeddingConcurrency;
  const embeddingConcurrency =
    typeof rawConcurrency === "number" && Number.isFinite(rawConcurrency) && rawConcurrency >= 1
      ? Math.min(16, Math.trunc(rawConcurrency))
      : undefined;

  const language = pickLanguage(job.metadata);

  const progress = registerKbExport({
    userId: auth.userId,
    jobId: job.id,
    collectionName,
  });

  void runKbExport({
    jobId: job.id,
    fileName: job.fileName,
    extractedText: job.extractedText,
    extractedAt: (job.completedAt ?? job.createdAt).toISOString(),
    sourceModel: job.model ?? undefined,
    language,
    chunking,
    embedding,
    embeddingConcurrency,
    store: buildVectorStore(vectorStore.kind, vectorStore.baseUrl, vectorStore.apiKey || undefined, vectorStore.dimensions),
    collectionName,
    onProgress: (event) =>
      updateKbExport(progress.exportId, {
        phase: event.phase,
        embeddingDone: event.embeddingDone ?? 0,
        embeddingTotal: event.embeddingTotal ?? 0,
        chunkCount: event.chunkCount ?? 0,
      }),
  })
    .then((result) => {
      updateKbExport(progress.exportId, {
        phase: "done",
        chunkCount: result.chunkCount,
        embeddingDone: result.chunkCount,
        embeddingTotal: result.chunkCount,
      });
    })
    .catch((err: unknown) => {
      updateKbExport(progress.exportId, {
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return NextResponse.json({ exportId: progress.exportId, collectionName }, { status: 202 });
});

function pickLanguage(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const lang = (metadata as Record<string, unknown>).language;
  return typeof lang === "string" && lang.length <= 8 ? lang : undefined;
}
