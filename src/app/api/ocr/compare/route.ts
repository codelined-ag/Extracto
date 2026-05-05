import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { diffWords, summarizeDiff } from "@/lib/diff/word-diff";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import {
  normalizeOcrInputPreviews,
  normalizeOcrPageNumbers,
  normalizePreviewForHistory,
  normalizeSourcePdfForAnchoring,
} from "@/lib/ocr/job-input-helpers";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";

const MIN_MODELS = 2;
const MAX_MODELS = 4;
const MAX_CONCURRENT_COMPARISONS = 3;

interface CompareBody extends Record<string, unknown> {
  fileName?: unknown;
  preview?: unknown;
  pages?: unknown;
  pageNumbers?: unknown;
  sourcePdf?: unknown;
  models?: unknown;
}

export const POST = withMutationAuth("ocr:submit", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<CompareBody>(request);
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const preview = typeof body.preview === "string" ? body.preview.trim() : "";
  const modelsRaw = Array.isArray(body.models) ? body.models : [];
  const models = modelsRaw.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim());
  if (!fileName || !preview) throw new ApiRouteError("fileName and preview are required", 400);
  if (models.length < MIN_MODELS) throw new ApiRouteError(`At least ${MIN_MODELS} models are required`, 400);
  if (models.length > MAX_MODELS) throw new ApiRouteError(`At most ${MAX_MODELS} models allowed per comparison`, 400);
  if (new Set(models).size !== models.length) throw new ApiRouteError("Duplicate models are not allowed", 400);

  const inflightComparisons = await db.ocrJob.findMany({
    where: {
      userId: auth.userId,
      comparisonId: { not: null },
      status: { in: [OcrJobStatus.QUEUED, OcrJobStatus.PROCESSING] },
    },
    select: { comparisonId: true },
    distinct: ["comparisonId"],
  });
  if (inflightComparisons.length >= MAX_CONCURRENT_COMPARISONS) {
    throw new ApiRouteError(
      `Already ${inflightComparisons.length} comparisons in flight (max ${MAX_CONCURRENT_COMPARISONS}). Wait for one to finish.`,
      429,
    );
  }

  const inputPreviews = normalizeOcrInputPreviews(body.pages, preview);
  const pageNumbers = normalizeOcrPageNumbers(body.pageNumbers, inputPreviews.length);
  const sourcePdf = normalizeSourcePdfForAnchoring(body.sourcePdf, pageNumbers, inputPreviews.length);
  const sourcePreview = normalizePreviewForHistory(inputPreviews[0]);

  const comparisonId = `cmp_${randomBytes(8).toString("hex")}`;
  const apiKeyId = auth.method === "api-key" ? auth.apiKeyId ?? null : null;
  const ip = getClientIpAddress(request);

  const submissions: Array<{ model: string; jobId: string }> = [];
  const failures: Array<{ model: string; error: string }> = [];
  for (const model of models) {
    const limited = await enforceOcrSubmitRateLimit(auth, ip);
    if (limited) {
      failures.push({ model, error: `Rate limit exceeded for ${model}` });
      continue;
    }
    try {
      const inputs = await resolveOcrJobInputs({ userId: auth.userId, model });
      const { jobId } = await submitOcrJob({
        ...inputs,
        userId: auth.userId,
        apiKeyId,
        fileName,
        model,
        inputPreviews,
        pageNumbers,
        sourcePdf,
        sourcePreview,
        priority: 1,
      });
      await db.ocrJob.update({ where: { id: jobId }, data: { comparisonId } });
      submissions.push({ model, jobId });
    } catch (err) {
      failures.push({ model, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const status = failures.length === 0 ? 200 : submissions.length === 0 ? 502 : 207;
  return NextResponse.json(
    { comparisonId, jobs: submissions, failures: failures.length ? failures : undefined },
    { status },
  );
});

export const GET = withAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const url = new URL(request.url);
  const comparisonId = url.searchParams.get("id")?.trim();
  if (!comparisonId) throw new ApiRouteError("id query param required", 400);
  const jobs = await db.ocrJob.findMany({
    where: { comparisonId, userId: auth.userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      model: true,
      status: true,
      extractedText: true,
      metadata: true,
      processingMs: true,
      errorMessage: true,
      completedAt: true,
    },
  });
  const completed = jobs.filter((j) => j.status === OcrJobStatus.COMPLETED && typeof j.extractedText === "string");
  const MAX_DIFF_CHARS = 200_000;
  type DiffEntry = {
    baselineJobId: string;
    candidateJobId: string;
    segments?: import("@/lib/diff/word-diff").DiffSegment[];
    summary?: import("@/lib/diff/word-diff").DiffSummary;
    truncated?: boolean;
  };
  let diffs: DiffEntry[] | undefined;
  if (completed.length >= 2) {
    const [baseline, ...rest] = completed;
    const baselineText = baseline.extractedText ?? "";
    diffs = rest.map((candidate) => {
      const candidateText = candidate.extractedText ?? "";
      if (baselineText.length > MAX_DIFF_CHARS || candidateText.length > MAX_DIFF_CHARS) {
        return { baselineJobId: baseline.id, candidateJobId: candidate.id, truncated: true };
      }
      const segments = diffWords(baselineText, candidateText);
      return {
        baselineJobId: baseline.id,
        candidateJobId: candidate.id,
        segments,
        summary: summarizeDiff(segments),
      };
    });
  }
  return NextResponse.json({ comparisonId, jobs, diffs });
});
