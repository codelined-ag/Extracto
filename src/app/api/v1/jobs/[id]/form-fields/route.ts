import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { extractFormFields } from "@/lib/forms/extract";
import { readResultJson } from "@/lib/ocr/result-store";

export const GET = withAuth<{ id: string }>(
  "ocr:read",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Job id is required", 400);
    const job = await db.ocrJob.findFirst({
      where: { id, userId: auth.userId },
      select: {
        id: true,
        status: true,
        result: true,
        resultLocation: true,
        metadata: true,
      },
    });
    if (!job) throw new ApiRouteError("Job not found", 404);
    if (job.status !== "COMPLETED") {
      throw new ApiRouteError(`Job is ${job.status}; form fields are only available on COMPLETED jobs`, 409);
    }
    const result = await readResultJson(job.resultLocation, job.result);
    const extracted = extractFormFields(result);
    const meta = (job.metadata && typeof job.metadata === "object" ? job.metadata : {}) as Record<string, unknown>;
    const documentType =
      typeof meta.documentType === "object" && meta.documentType
        ? (meta.documentType as { kind?: unknown }).kind
        : undefined;
    return NextResponse.json({
      jobId: job.id,
      documentType: typeof documentType === "string" ? documentType : null,
      source: extracted.source,
      fields: extracted.fields,
      byField: extracted.byField,
    });
  },
);
