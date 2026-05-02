import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

const MAX_PAGE_SIZE = 100;

const parseLimit = (value: string | null): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 20;
  }

  return Math.min(parsed, MAX_PAGE_SIZE);
};

const parseStatusFilter = (value: string | null): OcrJobStatus | null | undefined => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return undefined;
  return Object.values(OcrJobStatus).includes(normalized as OcrJobStatus)
    ? (normalized as OcrJobStatus)
    : null;
};

export const GET = withAuth("ocr:read", async (request: NextRequest, { auth }) => {
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
      userId: auth.userId,
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
});

export const DELETE = withMutationAuth("ocr:control", async (request: NextRequest, { auth }) => {
  const { searchParams } = new URL(request.url);
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
      userId: auth.userId,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
  });

  return NextResponse.json({ deleted: bulk.count });
});
