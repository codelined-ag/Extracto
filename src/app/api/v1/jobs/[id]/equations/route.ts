import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { extractEquations } from "@/lib/equations/extract";
import { readResultText } from "@/lib/ocr/result-store";

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
        extractedText: true,
        extractedTextLocation: true,
      },
    });
    if (!job) throw new ApiRouteError("Job not found", 404);
    if (job.status !== "COMPLETED") {
      throw new ApiRouteError(`Job is ${job.status}; equations are only available on COMPLETED jobs`, 409);
    }
    const text = (await readResultText(job.extractedTextLocation, job.extractedText)) ?? "";
    const eqs = extractEquations(text);
    return NextResponse.json({
      jobId: job.id,
      count: eqs.count,
      display: eqs.display,
      inline: eqs.inline,
    });
  },
);
