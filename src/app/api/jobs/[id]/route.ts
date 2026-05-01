import { NextRequest, NextResponse } from "next/server";

import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { readResultJson, readResultText } from "@/lib/result-store";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scopeError = requireScope(auth, "ocr:read");
  if (scopeError) return scopeError;
  const userId = auth.userId;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Job id is required" }, { status: 400 });
  }

  const row = await db.ocrJob.findFirst({
    where: { id, userId },
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
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
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
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateMutation(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const scopeError = requireScope(authResult.auth, "ocr:control");
  if (scopeError) return scopeError;
  const userId = authResult.auth.userId;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Job id is required" }, { status: 400 });
  }

  const deleteResult = await db.ocrJob.deleteMany({
    where: { id, userId },
  });

  if (deleteResult.count === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: deleteResult.count });
}
