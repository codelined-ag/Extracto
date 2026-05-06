import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { deleteResultArtifacts } from "@/lib/ocr/result-store";

const MAX_PAGE_TEXT_BYTES = 1_000_000;
const MAX_HISTORY_ENTRIES_PER_PAGE = 20;
const MAX_HISTORY_ENTRY_CHARS = 32_000;

interface PatchPageBody extends Record<string, unknown> {
  text?: unknown;
}

interface PageEditEntry {
  text: string;
  editedAt: string;
  characterCount: number;
  truncated?: boolean;
}

function readPageEdits(metadata: unknown): Record<string, PageEditEntry[]> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const raw = (metadata as { pageEdits?: unknown }).pageEdits;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PageEditEntry[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    out[key] = value
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .map((entry) => ({
        text: typeof entry.text === "string" ? entry.text : "",
        editedAt: typeof entry.editedAt === "string" ? entry.editedAt : "",
        characterCount: typeof entry.characterCount === "number" ? entry.characterCount : 0,
        ...(entry.truncated === true ? { truncated: true } : {}),
      }));
  }
  return out;
}

function pickPagesArray(metadata: unknown): Array<Record<string, unknown>> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const pageRecords = (metadata as { pageRecords?: unknown }).pageRecords;
  if (!Array.isArray(pageRecords)) return [];
  return pageRecords.filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"));
}

function restitch(pageRecords: Array<Record<string, unknown>>): string {
  const ordered = [...pageRecords].sort((a, b) => {
    const an = typeof a.pageNumber === "number" ? a.pageNumber : 0;
    const bn = typeof b.pageNumber === "number" ? b.pageNumber : 0;
    return an - bn;
  });
  const parts: string[] = [];
  for (const page of ordered) {
    const text = typeof page.text === "string" ? page.text.trim() : "";
    if (!text) continue;
    parts.push(text);
  }
  return parts.join("\n\n---\n\n");
}

export const PATCH = withMutationAuth<{ id: string; pageNumber: string }>(
  "ocr:control",
  async (request: NextRequest, { params, auth }) => {
    const { id, pageNumber: pageNumberRaw } = await params;
    const pageNumber = Number(pageNumberRaw);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new ApiRouteError("pageNumber must be a positive integer", 400);
    }

    const body = await parseJsonBody<PatchPageBody>(request);
    if (typeof body.text !== "string") {
      throw new ApiRouteError("text (string) is required", 400);
    }
    if (Buffer.byteLength(body.text, "utf8") > MAX_PAGE_TEXT_BYTES) {
      throw new ApiRouteError(`text exceeds ${MAX_PAGE_TEXT_BYTES} bytes`, 413);
    }

    const job = await db.ocrJob.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true, metadata: true, status: true, extractedTextLocation: true, editedAt: true },
    });
    if (!job) throw new ApiRouteError("Job not found", 404);
    if (job.status !== "COMPLETED") {
      throw new ApiRouteError("Only COMPLETED jobs can be edited", 400);
    }

    const pageRecords = pickPagesArray(job.metadata);
    const target = pageRecords.find((p) => p.pageNumber === pageNumber);
    if (!target) {
      throw new ApiRouteError(`Page ${pageNumber} not found in job`, 404);
    }
    const previousText = typeof target.text === "string" ? target.text : "";
    target.text = body.text;
    if (target.structured && typeof target.structured === "object" && !Array.isArray(target.structured)) {
      (target.structured as Record<string, unknown>).markdown = body.text;
    }

    const restitched = restitch(pageRecords);

    const metadataObj =
      job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
    const editedAt = new Date().toISOString();
    const historyByPage = readPageEdits(metadataObj);
    const pageKey = String(pageNumber);
    const priorHistory = historyByPage[pageKey] ?? [];
    const truncatedText =
      previousText.length > MAX_HISTORY_ENTRY_CHARS
        ? previousText.slice(0, MAX_HISTORY_ENTRY_CHARS)
        : previousText;
    const newEntry: PageEditEntry = {
      text: truncatedText,
      editedAt,
      characterCount: previousText.length,
      ...(truncatedText.length < previousText.length ? { truncated: true } : {}),
    };
    const trimmedHistory = [newEntry, ...priorHistory].slice(0, MAX_HISTORY_ENTRIES_PER_PAGE);
    const nextPageEdits = { ...historyByPage, [pageKey]: trimmedHistory };
    const updatedMetadata = {
      ...metadataObj,
      pageRecords,
      userEdited: true,
      staleExports: true,
      lastEditedAt: editedAt,
      pageEdits: nextPageEdits,
    };

    const updateResult = await db.ocrJob.updateMany({
      where: { id: job.id, editedAt: job.editedAt },
      data: {
        extractedText: restitched,
        extractedTextLocation: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: updatedMetadata as any as Prisma.InputJsonValue,
        userEdited: true,
        editedAt: new Date(),
      },
    });
    if (updateResult.count === 0) {
      throw new ApiRouteError("Page was edited concurrently; reload and try again", 409);
    }

    if (job.extractedTextLocation) {
      void deleteResultArtifacts([job.extractedTextLocation]).catch((err) => {
        console.warn("[page-edit] failed to delete prior S3 artifact:", err);
      });
    }

    return NextResponse.json({
      ok: true,
      pageNumber,
      extractedTextLength: restitched.length,
      historyLength: trimmedHistory.length,
      hint: "exports not refreshed, re-export to KB/S3 manually if needed",
    });
  },
);

export const GET = withAuth<{ id: string; pageNumber: string }>(
  "ocr:read",
  async (_request: NextRequest, { params, auth }) => {
    const { id, pageNumber: pageNumberRaw } = await params;
    const pageNumber = Number(pageNumberRaw);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new ApiRouteError("pageNumber must be a positive integer", 400);
    }
    const job = await db.ocrJob.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true, metadata: true },
    });
    if (!job) throw new ApiRouteError("Job not found", 404);
    const history = readPageEdits(job.metadata)[String(pageNumber)] ?? [];
    return NextResponse.json({ pageNumber, history });
  },
);
