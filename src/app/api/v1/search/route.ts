import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import { withAuth } from "@/lib/auth/request";
import {
  buildFtsMatchExpression,
  isFtsAvailable,
  setupOcrJobFts,
} from "@/lib/background/fts5-setup";
import { db } from "@/lib/db";
import { readResultText } from "@/lib/ocr/result-store";

const MAX_LIMIT = 50;
const SNIPPET_RADIUS = 80;
const DEFAULT_OFFLOADED_SCAN_LIMIT = 200;
const MAX_OFFLOADED_SCAN_LIMIT = 1000;

interface SearchRow {
  id: string;
  fileName: string;
  status: string;
  model: string;
  createdAt: Date | string;
  completedAt: Date | string | null;
  snippet: string | null;
  snippetStart: number | bigint | null;
  textLength: number | bigint | null;
}

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

function getOffloadedScanLimit(): number {
  const configured = Number(process.env.SEARCH_OFFLOADED_SCAN_LIMIT || "");
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_OFFLOADED_SCAN_LIMIT;
  }
  return Math.min(MAX_OFFLOADED_SCAN_LIMIT, Math.trunc(configured));
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

  await setupOcrJobFts();
  const ftsExpression = isFtsAvailable() ? buildFtsMatchExpression(q) : null;

  const inlineRows = ftsExpression
    ? await db.$queryRaw<SearchRow[]>(Prisma.sql`
        SELECT
          j."id",
          j."fileName",
          j."status",
          j."model",
          j."createdAt",
          j."completedAt",
          substr(
            j."extractedText",
            CASE
              WHEN instr(lower(j."extractedText"), lower(${q})) > ${SNIPPET_RADIUS}
                THEN instr(lower(j."extractedText"), lower(${q})) - ${SNIPPET_RADIUS}
              ELSE 1
            END,
            ${SNIPPET_RADIUS * 2} + length(${q})
          ) AS "snippet",
          CASE
            WHEN instr(lower(j."extractedText"), lower(${q})) > ${SNIPPET_RADIUS}
              THEN instr(lower(j."extractedText"), lower(${q})) - ${SNIPPET_RADIUS}
            ELSE 1
          END AS "snippetStart",
          length(j."extractedText") AS "textLength"
        FROM "OcrJob" j
        JOIN "OcrJobFts" f ON f.rowid = j.rowid
        WHERE
          j."userId" = ${auth.userId}
          AND j."extractedText" IS NOT NULL
          AND f."OcrJobFts" MATCH ${ftsExpression}
        ORDER BY j."createdAt" DESC
        LIMIT ${limit}
      `).catch((err) => {
        console.warn("[search] FTS query failed, falling back:", err);
        return null;
      }) ?? await db.$queryRaw<SearchRow[]>(Prisma.sql`
        SELECT
          "id",
          "fileName",
          "status",
          "model",
          "createdAt",
          "completedAt",
          substr(
            "extractedText",
            CASE
              WHEN instr(lower("extractedText"), lower(${q})) > ${SNIPPET_RADIUS}
                THEN instr(lower("extractedText"), lower(${q})) - ${SNIPPET_RADIUS}
              ELSE 1
            END,
            ${SNIPPET_RADIUS * 2} + length(${q})
          ) AS "snippet",
          CASE
            WHEN instr(lower("extractedText"), lower(${q})) > ${SNIPPET_RADIUS}
              THEN instr(lower("extractedText"), lower(${q})) - ${SNIPPET_RADIUS}
            ELSE 1
          END AS "snippetStart",
          length("extractedText") AS "textLength"
        FROM "OcrJob"
        WHERE
          "userId" = ${auth.userId}
          AND "extractedText" IS NOT NULL
          AND instr(lower("extractedText"), lower(${q})) > 0
        ORDER BY "createdAt" DESC
        LIMIT ${limit}
      `)
    : await db.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT
      "id",
      "fileName",
      "status",
      "model",
      "createdAt",
      "completedAt",
      substr(
        "extractedText",
        CASE
          WHEN instr(lower("extractedText"), lower(${q})) > ${SNIPPET_RADIUS}
            THEN instr(lower("extractedText"), lower(${q})) - ${SNIPPET_RADIUS}
          ELSE 1
        END,
        ${SNIPPET_RADIUS * 2} + length(${q})
      ) AS "snippet",
      CASE
        WHEN instr(lower("extractedText"), lower(${q})) > ${SNIPPET_RADIUS}
          THEN instr(lower("extractedText"), lower(${q})) - ${SNIPPET_RADIUS}
        ELSE 1
      END AS "snippetStart",
      length("extractedText") AS "textLength"
    FROM "OcrJob"
    WHERE
      "userId" = ${auth.userId}
      AND "extractedText" IS NOT NULL
      AND instr(lower("extractedText"), lower(${q})) > 0
    ORDER BY "createdAt" DESC
    LIMIT ${limit}
  `);

  const seen = new Set<string>();
  let offloadedScanned = 0;
  let offloadedSearchPartial = false;
  const results = inlineRows.map((row) => {
    seen.add(row.id);
    const snippetStart = Number(row.snippetStart ?? 1);
    const textLength = Number(row.textLength ?? row.snippet?.length ?? 0);
    const snippet = row.snippet
      ? `${snippetStart > 1 ? "…" : ""}${row.snippet}${snippetStart + row.snippet.length - 1 < textLength ? "…" : ""}`
      : null;
    return {
      id: row.id,
      fileName: row.fileName,
      status: row.status,
      model: row.model,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      snippet,
    };
  });

  if (results.length < limit) {
    const offloadedScanLimit = getOffloadedScanLimit();
    const offloadedCandidates = await db.ocrJob.findMany({
      where: {
        userId: auth.userId,
        extractedTextLocation: { not: null },
        id: { notIn: Array.from(seen) },
      },
      orderBy: { createdAt: "desc" },
      take: offloadedScanLimit + 1,
      select: {
        id: true,
        fileName: true,
        status: true,
        model: true,
        createdAt: true,
        completedAt: true,
        extractedText: true,
        extractedTextLocation: true,
      },
    });
    offloadedSearchPartial = offloadedCandidates.length > offloadedScanLimit;

    for (const row of offloadedCandidates.slice(0, offloadedScanLimit)) {
      if (results.length >= limit) break;
      offloadedScanned += 1;
      const text = await readResultText(row.extractedTextLocation, row.extractedText);
      if (!text || !text.toLowerCase().includes(q.toLowerCase())) continue;
      results.push({
        id: row.id,
        fileName: row.fileName,
        status: row.status,
        model: row.model,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        snippet: buildSnippet(text, q),
      });
    }
  }

  const responseResults = results.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    status: row.status,
    model: row.model,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    snippet: row.snippet,
  }));

  return NextResponse.json({
    q,
    count: responseResults.length,
    results: responseResults,
    offloadedSearch: {
      scanned: offloadedScanned,
      partial: responseResults.length < limit && offloadedSearchPartial,
    },
  });
});
