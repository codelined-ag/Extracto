import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { computeRecommendations, type JobSample } from "@/lib/recommendations/compute";

const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_LOOKBACK_DAYS = 365;
const MAX_SAMPLES = 1000;

export const GET = withAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get("days") ?? DEFAULT_LOOKBACK_DAYS);
  const days = Number.isFinite(daysRaw)
    ? Math.max(1, Math.min(MAX_LOOKBACK_DAYS, Math.trunc(daysRaw)))
    : DEFAULT_LOOKBACK_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.ocrJob.findMany({
    where: {
      userId: auth.userId,
      createdAt: { gte: since },
      status: { in: [OcrJobStatus.COMPLETED, OcrJobStatus.FAILED] },
    },
    select: {
      metadata: true,
      model: true,
      processingMs: true,
      status: true,
      settingsSnapshot: true,
      attemptCount: true,
      maxAttempts: true,
      errorMessage: true,
    },
    orderBy: { createdAt: "desc" },
    take: MAX_SAMPLES,
  });

  const samples: JobSample[] = [];
  for (const row of rows) {
    if (row.status === OcrJobStatus.FAILED && !isTerminalFailure(row)) continue;
    const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
    const docType = readDocumentType(meta);
    if (!docType) continue;
    const provider = normalizeProviderForKey(readProvider(meta, row.settingsSnapshot));
    samples.push({
      documentType: docType,
      provider,
      model: row.model.trim().toLowerCase(),
      status: row.status as JobSample["status"],
      processingMs: row.processingMs ?? null,
    });
  }

  const recommendations = computeRecommendations(samples);
  return NextResponse.json({
    lookbackDays: days,
    sampleCount: samples.length,
    totalScannedJobs: rows.length,
    recommendations,
  });
});

function readDocumentType(meta: Record<string, unknown>): string | null {
  const dt = meta.documentType;
  if (dt && typeof dt === "object") {
    const kind = (dt as Record<string, unknown>).kind;
    if (typeof kind === "string" && kind.length > 0) return kind;
  }
  return null;
}

const TRANSIENT_FAILURE_PATTERNS: RegExp[] = [
  /timed out/i,
  /timeout/i,
  /ECONNRESET/i,
  /ENETUNREACH/i,
  /5\d\d\b/,
  /gateway/i,
  /unavailable/i,
  /aborted/i,
];

function isTerminalFailure(row: { attemptCount: number; maxAttempts: number; errorMessage: string | null }): boolean {
  if (row.attemptCount < row.maxAttempts) return false;
  const msg = row.errorMessage ?? "";
  if (TRANSIENT_FAILURE_PATTERNS.some((re) => re.test(msg))) return false;
  return true;
}

function normalizeProviderForKey(provider: string): string {
  return provider.trim().toLowerCase();
}

function readProvider(meta: Record<string, unknown>, snapshot: unknown): string {
  if (typeof meta.provider === "string" && meta.provider.length > 0) return meta.provider;
  if (snapshot && typeof snapshot === "object") {
    const settings = (snapshot as Record<string, unknown>).settings;
    if (settings && typeof settings === "object") {
      const provider = (settings as Record<string, unknown>).provider;
      if (typeof provider === "string" && provider.length > 0) return provider;
    }
  }
  return "unknown";
}
