import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { authenticateMutation, getAuthenticatedUserId } from "@/lib/auth/request";
import { db } from "@/lib/db";

const MAX_PAGE_SIZE = 100;

const parseLimit = (value: string | null): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 20;
  }

  return Math.min(parsed, MAX_PAGE_SIZE);
};

const parseStatusFilter = (value: string | null) => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  return Object.values(OcrJobStatus).includes(normalized as OcrJobStatus)
    ? (normalized as OcrJobStatus)
    : null;
};

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = parseLimit(searchParams.get("limit"));
  const rawStatus = searchParams.get("status");
  const statusFilter = parseStatusFilter(rawStatus);

  if (rawStatus && statusFilter === null) {
    return NextResponse.json(
      {
        error: "Invalid status filter",
        validStatus: Object.values(OcrJobStatus),
      },
      { status: 400 }
    );
  }

  const jobs = await db.ocrJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    where: {
      userId,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
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
    },
  });

  return NextResponse.json({ jobs });
}

export async function DELETE(request: NextRequest) {
  const authResult = await authenticateMutation(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status });
  }
  const userId = authResult.auth.userId;

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("id");

  if (jobId) {
    const single = await db.ocrJob.deleteMany({
      where: { id: jobId, userId },
    });
    if (single.count === 0) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: single.count });
  }

  const rawStatus = searchParams.get("status");
  const statusFilter = parseStatusFilter(rawStatus);

  if (rawStatus && statusFilter === null) {
    return NextResponse.json(
      {
        error: "Invalid status filter",
        validStatus: Object.values(OcrJobStatus),
      },
      { status: 400 }
    );
  }

  const bulk = await db.ocrJob.deleteMany({
    where: {
      userId,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
  });

  return NextResponse.json({ deleted: bulk.count });
}
