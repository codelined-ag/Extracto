import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import {
  ExportTooLargeError,
  isExportFormat,
  renderJobExport,
  SUPPORTED_EXPORT_FORMATS,
} from "@/lib/export";
import { readResultJson, readResultText } from "@/lib/ocr/result-store";

export const GET = withAuth<{ id: string }>(
  "ocr:read",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Job id is required", 400);

    const url = new URL(request.url);
    const formatRaw = (url.searchParams.get("format") ?? "md").trim().toLowerCase();
    if (!isExportFormat(formatRaw)) {
      throw new ApiRouteError(
        `format must be one of ${SUPPORTED_EXPORT_FORMATS.join(", ")}`,
        400,
      );
    }

    const job = await db.ocrJob.findFirst({
      where: { id, userId: auth.userId },
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
      throw new ApiRouteError(`Job is ${job.status}, export is only available on COMPLETED jobs`, 409);
    }

    const text = (await readResultText(job.extractedTextLocation, job.extractedText)) ?? "";
    const result = await readResultJson(job.resultLocation, job.result);

    const meta = (job.metadata && typeof job.metadata === "object" ? job.metadata : {}) as Record<string, unknown>;
    const provider = typeof meta.provider === "string" ? meta.provider : "unknown";

    let rendered;
    try {
      rendered = await renderJobExport(formatRaw, {
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
    } catch (error) {
      if (error instanceof ExportTooLargeError) {
        throw new ApiRouteError(error.message, 413);
      }
      throw error;
    }

    return new NextResponse(new Uint8Array(rendered.body), {
      status: 200,
      headers: {
        "Content-Type": rendered.contentType,
        "Content-Disposition": `attachment; filename="${rendered.filename.replace(/"/g, '\\"')}"`,
        "Content-Length": String(rendered.body.byteLength),
        "Cache-Control": "no-store",
      },
    });
  },
);
