import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { enforceS3RateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import { getS3Defaults } from "@/lib/s3/defaults-store";
import { runS3Export } from "@/lib/s3/export";
import { registerS3Export, updateS3Export } from "@/lib/s3/export-progress";

interface S3ExportV1Request extends Record<string, unknown> {
  jobId?: unknown;
  keyPrefix?: unknown;
  /** When true (default) the response returns the full result synchronously instead of {exportId}. */
  wait?: unknown;
}

export const POST = withMutationAuth("s3:write", async (request: NextRequest, { auth }) => {
  const limited = await enforceS3RateLimit(auth, getClientIpAddress(request), "write");
  if (limited) return limited;
  const body = await parseJsonBody<S3ExportV1Request>(request);
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) throw new ApiRouteError("jobId (string) is required", 400);
  const keyPrefix = typeof body.keyPrefix === "string" ? body.keyPrefix.trim() : undefined;
  const wait = body.wait === undefined ? true : Boolean(body.wait);

  const defaults = await getS3Defaults(auth.userId);
  if (!defaults.bucket) {
    throw new ApiRouteError("S3 bucket is not configured for this user.", 400);
  }

  const job = await db.ocrJob.findFirst({
    where: { id: jobId, userId: auth.userId },
    select: { id: true },
  });
  if (!job) throw new ApiRouteError("Job not found", 404);

  const progress = registerS3Export({ userId: auth.userId, jobId: job.id, bucket: defaults.bucket });

  if (wait) {
    try {
      const result = await runS3Export({
        exportId: progress.exportId,
        userId: auth.userId,
        jobId: job.id,
        keyPrefix,
      });
      return NextResponse.json({ exportId: progress.exportId, ...result });
    } catch (err) {
      updateS3Export(progress.exportId, {
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  void runS3Export({
    exportId: progress.exportId,
    userId: auth.userId,
    jobId: job.id,
    keyPrefix,
  }).catch((err: unknown) => {
    updateS3Export(progress.exportId, {
      phase: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({ exportId: progress.exportId, bucket: defaults.bucket }, { status: 202 });
});
