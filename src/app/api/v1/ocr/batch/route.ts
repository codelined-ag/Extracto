import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, errorMessage } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import {
  normalizeOcrInputPreviews,
  normalizeOcrPageNumbers,
  normalizePreviewForHistory,
  normalizeSourcePdfForAnchoring,
} from "@/lib/ocr/job-input-helpers";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import type { AdvancedSettings, PostProcessingSettings } from "@/lib/ocr/settings";
import { getApiSettings } from "@/lib/ocr/settings-store";
import { MAX_BATCH_OCR_SUBMIT_PAGES } from "@/lib/ocr/input-limits";

const MAX_BATCH_SIZE = 50;

interface BatchFile {
  fileName: string;
  preview: string;
  inputPreviews: string[];
  pageNumbers?: number[];
  sourcePdf?: string;
  model: string;
  priority?: number;
  postProcessing?: Partial<PostProcessingSettings>;
  settings?: Partial<AdvancedSettings>;
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
  let totalPages = 0;
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
    let inputPreviews: string[];
    let pageNumbers: number[] | undefined;
    try {
      inputPreviews = normalizeOcrInputPreviews(f.pages, preview);
      pageNumbers = normalizeOcrPageNumbers(f.pageNumbers, inputPreviews.length);
    } catch (error) {
      return { error: errorMessage(error, "Invalid page input") };
    }
    totalPages += inputPreviews.length;
    if (totalPages > MAX_BATCH_OCR_SUBMIT_PAGES) {
      return { error: `Maximum of ${MAX_BATCH_OCR_SUBMIT_PAGES} page images per batch` };
    }
    const priority =
      typeof f.priority === "number" && Number.isFinite(f.priority)
        ? Math.max(-10, Math.min(10, Math.trunc(f.priority)))
        : 0;
    const sourcePdf = normalizeSourcePdfForAnchoring(f.sourcePdf, pageNumbers, inputPreviews.length);
    parsed.push({
      fileName,
      preview,
      inputPreviews,
      pageNumbers,
      sourcePdf,
      model,
      priority,
      postProcessing: f.postProcessing as Partial<PostProcessingSettings> | undefined,
      settings: f.settings as Partial<AdvancedSettings> | undefined,
    });
  }
  return parsed;
}

export const POST = withMutationAuth("ocr:submit", async (request: NextRequest, { auth }) => {
  const limited = await enforceOcrSubmitRateLimit(auth, getClientIpAddress(request));
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const parsed = parseBatchBody(raw);
  if (!Array.isArray(parsed)) {
    throw new ApiRouteError(parsed.error, 400);
  }

  const preloadedSettings = await getApiSettings(auth.userId);
  const apiKeyId = auth.method === "api-key" ? auth.apiKeyId ?? null : null;
  const batchId = `batch_${randomBytes(8).toString("hex")}`;

  const submissions: Array<{ fileName: string; jobId?: string; error?: string }> = [];
  for (const file of parsed) {
    try {
      const inputs = await resolveOcrJobInputs({
        userId: auth.userId,
        model: file.model,
        perRequestSettings: file.settings,
        perRequestPostProcessing: file.postProcessing,
        preloadedSettings,
      });
      const sourcePreview = normalizePreviewForHistory(file.inputPreviews[0] || "");

      const { jobId } = await submitOcrJob({
        ...inputs,
        userId: auth.userId,
        apiKeyId,
        fileName: file.fileName,
        model: file.model,
        inputPreviews: file.inputPreviews,
        pageNumbers: file.pageNumbers,
        sourcePdf: file.sourcePdf,
        sourcePreview,
        priority: file.priority,
        batchId,
      });
      submissions.push({ fileName: file.fileName, jobId });
    } catch (error) {
      submissions.push({
        fileName: file.fileName,
        error: errorMessage(error, "submission failed"),
      });
    }
  }

  return NextResponse.json({ batchId, submissions });
});
