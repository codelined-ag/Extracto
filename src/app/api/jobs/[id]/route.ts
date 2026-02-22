import { NextRequest, NextResponse } from "next/server";

import { getAuthCookieName, verifySessionToken } from "@/lib/auth/token";
import { db } from "@/lib/db";

async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(getAuthCookieName())?.value;
  const payload = await verifySessionToken(token);
  return payload?.userId ?? null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Job id is required" }, { status: 400 });
  }

  const job = await db.ocrJob.findFirst({
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
      result: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Job id is required" }, { status: 400 });
  }

  const result = await db.ocrJob.deleteMany({
    where: { id, userId },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: result.count });
}
