import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { isExportFormat, renderJobExport } from "@/lib/export";
import { isCloudProvider, uploadCloudFile } from "@/lib/integrations/dispatch";
import { readResultJson, readResultText } from "@/lib/ocr/result-store";

interface PushBody extends Record<string, unknown> {
  jobId?: unknown;
  folder?: unknown;
  format?: unknown;
}

export const POST = withSessionAuth<{ provider: string }>(
  "mutation",
  "Integration push",
  async (request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isCloudProvider(provider)) throw new ApiRouteError("Unknown provider", 400);
    const body = await parseJsonBody<PushBody>(request);
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const folder = typeof body.folder === "string" ? body.folder.trim() : "";
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
    const providerLabel = typeof meta.provider === "string" ? meta.provider : "unknown";

    const rendered = await renderJobExport(formatRaw, {
      jobId: job.id,
      fileName: job.fileName,
      provider: providerLabel,
      model: job.model,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      sourcePreview: job.sourcePreview,
      extractedText: text,
      result,
    });

    const buf = rendered.body;
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

    try {
      const upload = await uploadCloudFile(provider, auth.userId, folder, rendered.filename, data);
      return NextResponse.json({
        provider,
        jobId,
        format: formatRaw,
        path: upload.path,
        size: upload.size,
      });
    } catch (err) {
      throw new ApiRouteError((err as Error).message, 502);
    }
  },
);
