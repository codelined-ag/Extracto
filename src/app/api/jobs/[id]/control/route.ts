import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { authenticateMutation } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { abortOcrJobRequests, isOcrJobRunning, requestOcrJobStop } from "@/lib/ocr/job-control";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateMutation(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const userId = authResult.auth.userId;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Job id is required" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: unknown;
      }
    | null;
  const action = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
  if (action !== "stop") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const job = await db.ocrJob.findFirst({
    where: { id, userId },
    select: {
      id: true,
      status: true,
      metadata: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  await requestOcrJobStop(id);
  abortOcrJobRequests(id);
  const running = isOcrJobRunning(id);

  const metadata =
    job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
      ? (job.metadata as Record<string, unknown>)
      : {};
  const updatedMetadata = {
    ...metadata,
    stopRequested: true,
    message: running ? "Stop requested. Aborting current inference..." : "Stop requested",
    updatedAt: new Date().toISOString(),
  };

  await db.ocrJob.update({
    where: { id },
    data: {
      metadata: updatedMetadata as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({
    success: true,
    stopRequested: true,
    running,
  });
}
