import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
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

interface PatchJobBody extends Record<string, unknown> {
  priority?: unknown;
}

export const PATCH = withMutationAuth<{ id: string }>(
  "ocr:control",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    const body = await parseJsonBody<PatchJobBody>(request);
    const data: Record<string, unknown> = {};
    if (body.priority !== undefined) {
      const p = Number(body.priority);
      if (!Number.isFinite(p)) throw new ApiRouteError("priority must be a number", 400);
      data.priority = Math.max(-10, Math.min(10, Math.trunc(p)));
    }
    if (Object.keys(data).length === 0) {
      throw new ApiRouteError("No mutable fields supplied", 400);
    }
    const result = await db.ocrJob.updateMany({
      where: { id, userId: auth.userId },
      data,
    });
    if (result.count === 0) throw new ApiRouteError("Job not found", 404);
    return NextResponse.json({ ok: true });
  },
);
