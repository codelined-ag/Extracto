import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus, Prisma } from "@prisma/client";

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

type StatusFilter =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "value"; status: OcrJobStatus };

const parseStatusFilter = (value: string | null): StatusFilter => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return { kind: "absent" };
  if (Object.values(OcrJobStatus).includes(normalized as OcrJobStatus)) {
    return { kind: "value", status: normalized as OcrJobStatus };
  }
  return { kind: "invalid" };
};

const parseDate = (value: string | null, endOfDay: boolean): Date | null => {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  const date = new Date(ts);
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
};

const parseTagIds = (value: string | null): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

export const GET = withAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const { searchParams } = new URL(request.url);
  const limit = parseLimit(searchParams.get("limit"));
  const statusFilter = parseStatusFilter(searchParams.get("status"));

  if (statusFilter.kind === "invalid") {
    return NextResponse.json(
      {
        error: "Invalid status filter",
        validStatus: Object.values(OcrJobStatus),
      },
      { status: 400 }
    );
  }

  const q = (searchParams.get("q") ?? "").trim();
  const model = (searchParams.get("model") ?? "").trim();
  const from = parseDate(searchParams.get("from"), false);
  const to = parseDate(searchParams.get("to"), true);
  const tagIds = parseTagIds(searchParams.get("tagIds"));

  const where: Prisma.OcrJobWhereInput = {
    userId: auth.userId,
    ...(statusFilter.kind === "value" ? { status: statusFilter.status } : {}),
    ...(q ? { fileName: { contains: q } } : {}),
    ...(model ? { model: { contains: model } } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    ...(tagIds.length > 0
      ? { jobTags: { some: { tagId: { in: tagIds } } } }
      : {}),
  };

  const rows = await db.ocrJob.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    where,
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
      jobTags: {
        select: {
          tag: { select: { id: true, name: true, color: true } },
        },
      },
    },
  });

  const jobs = rows.map(({ jobTags, ...rest }) => ({
    ...rest,
    tags: jobTags.map((jt) => jt.tag),
  }));

  return NextResponse.json({ jobs });
});

export const DELETE = withMutationAuth("ocr:control", async (request: NextRequest, { auth }) => {
  const { searchParams } = new URL(request.url);
  const statusFilter = parseStatusFilter(searchParams.get("status"));

  if (statusFilter.kind === "invalid") {
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
      ...(statusFilter.kind === "value" ? { status: statusFilter.status } : {}),
    },
  });

  return NextResponse.json({ deleted: bulk.count });
});
