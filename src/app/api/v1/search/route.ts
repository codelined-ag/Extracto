import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

const MAX_LIMIT = 50;
const SNIPPET_RADIUS = 80;

function buildSnippet(text: string, query: string): string {
  const lowered = text.toLowerCase();
  const lq = query.toLowerCase();
  const idx = lowered.indexOf(lq);
  if (idx < 0) {
    return text.slice(0, SNIPPET_RADIUS * 2);
  }
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + lq.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export const GET = withAuth("search:read", async (request: NextRequest, { auth }) => {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) {
    throw new ApiRouteError("q is required", 400);
  }
  if (q.length < 2) {
    throw new ApiRouteError("q must be at least 2 characters", 400);
  }
  if (q.length > 200) {
    throw new ApiRouteError("q is too long (max 200 chars)", 400);
  }

  const rawLimit = Number(searchParams.get("limit") || "20");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, Math.trunc(rawLimit)) : 20;

  const rows = await db.ocrJob.findMany({
    where: {
      userId: auth.userId,
      extractedText: { contains: q },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      fileName: true,
      status: true,
      model: true,
      createdAt: true,
      completedAt: true,
      extractedText: true,
    },
  });

  const results = rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    model: row.model,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    snippet: row.extractedText ? buildSnippet(row.extractedText, q) : null,
  }));

  return NextResponse.json({ q, count: results.length, results });
});
