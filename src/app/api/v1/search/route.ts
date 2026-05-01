import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest, requireScope } from "@/lib/auth/request";
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

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scopeError = requireScope(auth, "search:read");
  if (scopeError) return scopeError;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  if (q.length < 2) {
    return NextResponse.json({ error: "q must be at least 2 characters" }, { status: 400 });
  }
  if (q.length > 200) {
    return NextResponse.json({ error: "q is too long (max 200 chars)" }, { status: 400 });
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
}
