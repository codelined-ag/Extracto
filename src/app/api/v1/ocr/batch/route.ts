import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { buildOcrForwardHeaders, resolveInternalOcrEndpoint } from "@/lib/ocr/forward";

const MAX_BATCH_SIZE = 50;

interface BatchFile {
  fileName: string;
  preview: string;
  pages?: string[];
  model: string;
  priority?: number;
  postProcessing?: unknown;
  settings?: unknown;
}

function parseBatchBody(raw: unknown): BatchFile[] | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid JSON payload" };
  const files = (raw as { files?: unknown }).files;
  if (!Array.isArray(files)) return { error: "files must be an array" };
  if (files.length === 0) return { error: "files array is empty" };
  if (files.length > MAX_BATCH_SIZE) {
    return { error: `Maximum of ${MAX_BATCH_SIZE} files per batch` };
  }
  const parsed: BatchFile[] = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object") {
      return { error: "Each file must be an object" };
    }
    const f = entry as Record<string, unknown>;
    const fileName = typeof f.fileName === "string" ? f.fileName.trim() : "";
    const preview = typeof f.preview === "string" ? f.preview.trim() : "";
    const model = typeof f.model === "string" ? f.model.trim() : "";
    if (!fileName || !preview || !model) {
      return { error: "Each file requires fileName, preview, and model" };
    }
    const pages = Array.isArray(f.pages)
      ? f.pages.filter((p): p is string => typeof p === "string")
      : undefined;
    const priority =
      typeof f.priority === "number" && Number.isFinite(f.priority)
        ? Math.max(-10, Math.min(10, Math.trunc(f.priority)))
        : 0;
    parsed.push({
      fileName,
      preview,
      pages,
      model,
      priority,
      postProcessing: f.postProcessing,
      settings: f.settings,
    });
  }
  return parsed;
}

export const POST = withMutationAuth("ocr:submit", async (request: NextRequest) => {
  const raw = await request.json().catch(() => null);
  const parsed = parseBatchBody(raw);
  if (!Array.isArray(parsed)) {
    throw new ApiRouteError(parsed.error, 400);
  }

  const batchId = `batch_${randomBytes(8).toString("hex")}`;
  const submitUrl = resolveInternalOcrEndpoint();
  const fetchHeaders = buildOcrForwardHeaders(request);

  const submissions: Array<{ fileName: string; jobId?: string; error?: string; status?: number }> = [];
  for (const file of parsed) {
    try {
      const response = await fetch(submitUrl, {
        method: "POST",
        headers: fetchHeaders,
        body: JSON.stringify({
          fileName: file.fileName,
          preview: file.preview,
          pages: file.pages,
          model: file.model,
          priority: file.priority,
          batchId,
          postProcessing: file.postProcessing,
          settings: file.settings,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { jobId?: string; error?: string }
        | null;
      if (!response.ok) {
        submissions.push({
          fileName: file.fileName,
          error: payload?.error || `HTTP ${response.status}`,
          status: response.status,
        });
      } else {
        submissions.push({
          fileName: file.fileName,
          jobId: typeof payload?.jobId === "string" ? payload.jobId : undefined,
        });
      }
    } catch (error) {
      submissions.push({
        fileName: file.fileName,
        error: error instanceof Error ? error.message : "submission failed",
      });
    }
  }

  return NextResponse.json({ batchId, submissions });
});
