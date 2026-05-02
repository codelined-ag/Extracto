import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { readResultJson, readResultText } from "@/lib/ocr/result-store";

export const GET = withAuth<{ id: string }>(
  "ocr:read",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Job id is required", 400);
    }

    const row = await db.ocrJob.findFirst({
      where: { id, userId: auth.userId },
      select: {
        id: true,
        status: true,
        fileName: true,
        sourcePreview: true,
        model: true,
        createdAt: true,
        completedAt: true,
        processingMs: true,
        metadata: true,
        errorMessage: true,
        extractedText: true,
        extractedTextLocation: true,
        result: true,
        resultLocation: true,
      },
    });

    if (!row) {
      throw new ApiRouteError("Job not found", 404);
    }

    const [extractedText, result] = await Promise.all([
      readResultText(row.extractedTextLocation, row.extractedText),
      readResultJson(row.resultLocation, row.result),
    ]);

    const job = {
      id: row.id,
      status: row.status,
      fileName: row.fileName,
      sourcePreview: row.sourcePreview,
      model: row.model,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      processingMs: row.processingMs,
      metadata: row.metadata,
      errorMessage: row.errorMessage,
      extractedText,
      result,
    };

    return NextResponse.json({ job });
  },
);

export const DELETE = withMutationAuth<{ id: string }>(
  "ocr:control",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Job id is required", 400);
    }

    const deleteResult = await db.ocrJob.deleteMany({
      where: { id, userId: auth.userId },
    });

    if (deleteResult.count === 0) {
      throw new ApiRouteError("Job not found", 404);
    }

    return NextResponse.json({ deleted: deleteResult.count });
  },
);
