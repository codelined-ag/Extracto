import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, errorMessage } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { normalizeProvider } from "@/lib/endpoint-policy";
import {
  buildPrompt,
  normalizePreviewForHistory,
  resolveProvider,
  sanitizePostProcessing,
  submitOcrJob,
} from "@/lib/ocr/pipeline";
import {
  resolveMistralOcrModel,
} from "@/lib/ocr/providers/mistral";
import {
  normalizeAdvancedSettings,
  type AdvancedSettings,
  type PostProcessingSettings,
} from "@/lib/ocr/settings";
import { getApiSettings } from "@/lib/settings-store";

const MAX_BATCH_SIZE = 50;

interface BatchFile {
  fileName: string;
  preview: string;
  pages?: string[];
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
      postProcessing: f.postProcessing as Partial<PostProcessingSettings> | undefined,
      settings: f.settings as Partial<AdvancedSettings> | undefined,
    });
  }
  return parsed;
}

export const POST = withMutationAuth("ocr:submit", async (request: NextRequest, { auth }) => {
  const raw = await request.json().catch(() => null);
  const parsed = parseBatchBody(raw);
  if (!Array.isArray(parsed)) {
    throw new ApiRouteError(parsed.error, 400);
  }

  // Load the user's stored provider settings once for the whole batch.
  const storedSettings = await getApiSettings(auth.userId);
  const settings = {
    ...storedSettings,
    provider: normalizeProvider(storedSettings.provider),
  };
  const apiKeyId = auth.method === "api-key" ? auth.apiKeyId ?? null : null;
  const batchId = `batch_${randomBytes(8).toString("hex")}`;

  const submissions: Array<{ fileName: string; jobId?: string; error?: string }> = [];
  for (const file of parsed) {
    try {
      const settingsPayload = normalizeAdvancedSettings(file.settings);
      const postProcessingPayload = sanitizePostProcessing(file.postProcessing);
      const provider = resolveProvider(settings);
      const ocrModel = provider === "mistral" ? resolveMistralOcrModel(file.model) : file.model;
      const prompt = buildPrompt(settingsPayload);
      const inputPreviews = file.pages && file.pages.length > 0 ? file.pages : [file.preview];
      const sourcePreview = normalizePreviewForHistory(inputPreviews[0] || "");

      const { jobId } = await submitOcrJob({
        userId: auth.userId,
        apiKeyId,
        fileName: file.fileName,
        model: file.model,
        ocrModel,
        provider,
        settings,
        settingsPayload,
        postProcessingPayload,
        inputPreviews,
        prompt,
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
