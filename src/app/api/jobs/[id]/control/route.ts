import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { abortOcrJobRequests, isOcrJobRunning, requestOcrJobStop } from "@/lib/ocr/job-control";

export const POST = withMutationAuth<{ id: string }>(
  "ocr:control",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Job id is required", 400);
    }

    const body = await parseJsonBody<{ action?: unknown }>(request);
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (action !== "stop") {
      throw new ApiRouteError("Unsupported action", 400);
    }

    const job = await db.ocrJob.findFirst({
      where: { id, userId: auth.userId },
      select: {
        id: true,
        status: true,
        metadata: true,
      },
    });

    if (!job) {
      throw new ApiRouteError("Job not found", 404);
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
      stopRequested: true,
      running,
    });
  },
);
