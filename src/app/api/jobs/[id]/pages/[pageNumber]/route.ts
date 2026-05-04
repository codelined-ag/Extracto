import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { deleteResultArtifacts } from "@/lib/ocr/result-store";

const MAX_PAGE_TEXT_BYTES = 1_000_000;

interface PatchPageBody extends Record<string, unknown> {
  text?: unknown;
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
      select: { id: true, metadata: true, status: true, extractedTextLocation: true },
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
    target.text = body.text;
    if (target.structured && typeof target.structured === "object" && !Array.isArray(target.structured)) {
      (target.structured as Record<string, unknown>).markdown = body.text;
    }

    const restitched = restitch(pageRecords);

    const metadataObj =
      job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
    const updatedMetadata = {
      ...metadataObj,
      pageRecords,
      userEdited: true,
      staleExports: true,
      lastEditedAt: new Date().toISOString(),
    };

    await db.ocrJob.update({
      where: { id: job.id },
      data: {
        extractedText: restitched,
        extractedTextLocation: null,
        metadata: updatedMetadata as Prisma.InputJsonValue,
        userEdited: true,
        editedAt: new Date(),
      },
    });

    if (job.extractedTextLocation) {
      void deleteResultArtifacts([job.extractedTextLocation]).catch((err) => {
        console.warn("[page-edit] failed to delete prior S3 artifact:", err);
      });
    }

    return NextResponse.json({
      ok: true,
      pageNumber,
      extractedTextLength: restitched.length,
      hint: "exports not refreshed — re-export to KB/S3 manually if needed",
    });
  },
);
