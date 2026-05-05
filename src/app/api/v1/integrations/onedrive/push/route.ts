import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { uploadOneDriveFile } from "@/lib/integrations/onedrive";
import { isExportFormat, renderJobExport } from "@/lib/export";
import { readResultJson, readResultText } from "@/lib/ocr/result-store";

export const POST = withMutationAuth("integrations:write", async (request: NextRequest, { auth }) => {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") throw new ApiRouteError("Invalid JSON payload", 400);
  const body = raw as Record<string, unknown>;
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const parentId = typeof body.parentId === "string" ? body.parentId.trim() : "";
  const formatRaw = typeof body.format === "string" ? body.format.trim().toLowerCase() : "md";
  if (!jobId) throw new ApiRouteError("jobId is required", 400);
  if (!isExportFormat(formatRaw)) throw new ApiRouteError("format must be a known export format", 400);

  const job = await db.ocrJob.findFirst({
    where: { id: jobId, userId: auth.userId },
    select: {
      id: true,
      status: true,
      fileName: true,
      model: true,
      sourcePreview: true,
      createdAt: true,
      completedAt: true,
      extractedText: true,
      extractedTextLocation: true,
      result: true,
      resultLocation: true,
      metadata: true,
    },
  });
  if (!job) throw new ApiRouteError("Job not found", 404);
  if (job.status !== "COMPLETED") {
    throw new ApiRouteError(`Job is ${job.status}, push is only available on COMPLETED jobs`, 409);
  }

  const text = (await readResultText(job.extractedTextLocation, job.extractedText)) ?? "";
  const result = await readResultJson(job.resultLocation, job.result);
  const meta = (job.metadata && typeof job.metadata === "object" ? job.metadata : {}) as Record<string, unknown>;
  const provider = typeof meta.provider === "string" ? meta.provider : "unknown";

  const rendered = await renderJobExport(formatRaw, {
    jobId: job.id,
    fileName: job.fileName,
    provider,
    model: job.model,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    sourcePreview: job.sourcePreview,
    extractedText: text,
    result,
  });

  const uploaded = await uploadOneDriveFile({
    userId: auth.userId,
    parentId: parentId || null,
    name: rendered.filename,
    bytes: rendered.body,
    contentType: rendered.contentType,
  });
  return NextResponse.json({ jobId, format: formatRaw, fileId: uploaded.id, name: uploaded.name, size: uploaded.size });
});
