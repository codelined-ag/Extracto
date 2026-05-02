import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { ApiProviderSettings, getApiSettings } from "@/lib/ocr/settings-store";
import { seedPostProcessingMeta } from "@/lib/ocr/job-seed";
import { normalizeMistralApiBase, resolveMistralOcrModel } from "@/lib/ocr/providers/mistral";
import {
  normalizeOpenAICompatApiBase,
  normalizeOpenRouterApiBase,
} from "@/lib/ocr/providers/compat";
import { authenticateMutation, requireScope, withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { enforceProviderEndpointPolicy, normalizeProvider, ProviderKind } from "@/lib/ocr/endpoint-policy";
import { withOcrJobSlot } from "@/lib/ocr/job-control";
import { resolveOllamaHostEndpoint } from "@/lib/ocr/host-normalization";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import {
  AdvancedSettings,
  normalizeAdvancedSettings,
  PostProcessingSettings,
} from "@/lib/ocr/settings";
import { ApiRouteError, handleApiError, pipelineStatusFor } from "@/lib/api-error";
import {
  getDefaultMistralApiUrl,
  getDefaultOpenAICompatApiUrl,
  getDefaultOpenRouterApiUrl,
} from "@/lib/ocr/provider-config";
import {
  buildProgressMetadata,
  buildPrompt,
  ocrStageProgressPct,
  getModelCatalog,
  normalizePreviewForHistory,
  getOllamaDiscoveryFallbackHost,
  parseCheckpointPages,
  processOcrJobInBackground,
  sanitizePostProcessing,
  submitOcrJob,
  toJsonValue,
} from "@/lib/ocr/pipeline";

interface OCRRequestBody {
  jobId?: unknown;
  resume?: unknown;
  fileName?: unknown;
  model?: unknown;
  preview?: unknown;
  pages?: unknown;
  priority?: unknown;
  batchId?: unknown;
  settings?: Partial<AdvancedSettings>;
  postProcessing?: Partial<PostProcessingSettings>;
}

function parseRequestPriority(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-10, Math.min(10, Math.trunc(value)));
}

function normalizeProviderEndpoint(provider: ProviderKind, rawEndpoint: string): string {
  if (provider === "mistral") {
    return enforceProviderEndpointPolicy("mistral",
      normalizeMistralApiBase(rawEndpoint || getDefaultMistralApiUrl()),
      getDefaultMistralApiUrl());
  }
  if (provider === "openrouter") {
    return enforceProviderEndpointPolicy("openrouter",
      normalizeOpenRouterApiBase(rawEndpoint || getDefaultOpenRouterApiUrl()),
      getDefaultOpenRouterApiUrl());
  }
  if (provider === "openai_compat") {
    return enforceProviderEndpointPolicy("openai_compat",
      normalizeOpenAICompatApiBase(rawEndpoint || getDefaultOpenAICompatApiUrl()),
      getDefaultOpenAICompatApiUrl());
  }
  return enforceProviderEndpointPolicy("ollama",
    resolveOllamaHostEndpoint(rawEndpoint || getOllamaDiscoveryFallbackHost(), getOllamaDiscoveryFallbackHost()),
    getOllamaDiscoveryFallbackHost());
}

function normalizeAndValidateApiSettings(raw: ApiProviderSettings): ApiProviderSettings {
  const provider = normalizeProvider(raw.provider);
  return {
    provider,
    apiEndpoint: normalizeProviderEndpoint(provider, raw.apiEndpoint),
    apiKey: raw.apiKey?.trim() || "",
  };
}



export const GET = withAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const storedSettings = normalizeAndValidateApiSettings(await getApiSettings(auth.userId));
  const query = new URL(request.url).searchParams;
  const provider = normalizeProvider(query.get("provider") || undefined);
  const catalog = await getModelCatalog(storedSettings);
  return NextResponse.json({ models: catalog[provider] });
});

export async function POST(request: NextRequest) {
  const startedAtMs = Date.now();
  try {
    const authResult = await authenticateMutation(request);
    if (!authResult.ok) {
      throw new ApiRouteError(authResult.error, authResult.status);
    }
    const auth = authResult.auth;
    const submitScopeError = requireScope(auth, "ocr:submit");
    if (submitScopeError) return submitScopeError;
    const userId = auth.userId;

    const limited = enforceOcrSubmitRateLimit(auth, getClientIpAddress(request));
    if (limited) return limited;

    const storedSettings = normalizeAndValidateApiSettings(await getApiSettings(userId));
    const body = (await request.json().catch(() => null)) as OCRRequestBody | null;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiRouteError("Invalid JSON payload", 400);
    }

    const fileName = typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim()
      : "untitled";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const preview = typeof body.preview === "string" ? body.preview.trim() : "";
    const pagePreviews = Array.isArray(body.pages)
      ? body.pages
          .map((page) => (typeof page === "string" ? page.trim() : ""))
          .filter(Boolean)
      : [];
    const inputPreviews = pagePreviews.length > 0
      ? pagePreviews
      : preview
        ? [preview]
        : [];
    const settingsPayload = normalizeAdvancedSettings(body.settings);
    const postProcessingPayload = sanitizePostProcessing(body.postProcessing);
    const settings = storedSettings;

    if (!model) {
      throw new ApiRouteError("Model is required", 400);
    }

    if (inputPreviews.length === 0) {
      throw new ApiRouteError("No image preview provided", 400);
    }

    const resumeRequested = body.resume === true || body.resume === "true";
    const resumeJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

    const provider = normalizeProvider((settings).provider);
    const ocrModel = provider === "mistral" ? resolveMistralOcrModel(model) : model;
    const prompt = buildPrompt(settingsPayload);
    const sourcePreview = normalizePreviewForHistory(inputPreviews[0] || "");
    const startedAtIso = new Date(startedAtMs).toISOString();

    if (resumeRequested) {
      if (!resumeJobId) {
        throw new ApiRouteError("jobId is required when resume=true", 400);
      }

      const existingJob = await db.ocrJob.findFirst({
        where: {
          id: resumeJobId,
          userId,
        },
        select: {
          id: true,
          status: true,
          result: true,
          metadata: true,
          priority: true,
        },
      });
      if (!existingJob) {
        throw new ApiRouteError("Resume job not found", 404);
      }

      if (existingJob.status === OcrJobStatus.COMPLETED) {
        throw new ApiRouteError("Job is already completed", 400);
      }
      if (existingJob.status === OcrJobStatus.PROCESSING) {
        throw new ApiRouteError("Job is already processing", 409);
      }

      const initialPageOutputs = parseCheckpointPages(existingJob.result, existingJob.metadata);
      const startIndex = initialPageOutputs.length;
      if (startIndex >= inputPreviews.length) {
        throw new ApiRouteError("All pages were already checkpointed for this job", 400);
      }

      const resumeMetadata = buildProgressMetadata({
        stage: "queued",
        message: `Resume requested from page ${startIndex + 1}/${inputPreviews.length}`,
        progressPct: ocrStageProgressPct(startIndex, inputPreviews.length, postProcessingPayload.enabled),
        pageCount: inputPreviews.length,
        processedPages: startIndex,
        currentPage: null,
        etaSeconds: null,
        startedAt: startedAtIso,
        events: [
          {
            at: startedAtIso,
            stage: "queued",
            message: "Resume requested",
          },
          ...(provider === "mistral" && ocrModel !== model
            ? [
                {
                  at: startedAtIso,
                  stage: "queued" as const,
                  message: `OCR will use ${ocrModel}; selected inference model is ${model}`,
                },
              ]
            : []),
        ],
        checkpoints: initialPageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          status: "completed",
          characterCount: page.text.length,
          durationMs: page.durationMs,
          previewText: page.text.trim().slice(0, 320),
        })),
        postProcessing: seedPostProcessingMeta(postProcessingPayload, postProcessingPayload.model || model),
      });

      await db.ocrJob.update({
        where: { id: existingJob.id },
        data: {
          status: OcrJobStatus.PROCESSING,
          sourcePreview,
          errorMessage: null,
          completedAt: null,
          processingMs: null,
          settingsSnapshot: toJsonValue({
            settings: settingsPayload,
            postProcessing: postProcessingPayload,
          }),
          prompt,
          metadata: toJsonValue(resumeMetadata),
        },
      });

      const resumePriority = (existingJob as { priority?: number }).priority ?? 0;
      void withOcrJobSlot(resumePriority, () =>
        processOcrJobInBackground({
          jobId: existingJob.id,
          startedAtMs,
          fileName,
          model,
          ocrModel,
          provider,
          settings,
          settingsPayload,
          postProcessingPayload,
          inputPreviews,
          prompt,
          initialPageOutputs,
          startIndex,
          resumed: true,
        })
      );

      return NextResponse.json(
        {
          status: OcrJobStatus.PROCESSING,
          jobId: existingJob.id,
          pageCount: inputPreviews.length,
          resumed: true,
          pageRecords: startIndex,
        },
        { status: 202 }
      );
    }

    const requestedPriority = parseRequestPriority(body?.priority);
    const requestedBatchId = typeof body?.batchId === "string" && body.batchId.trim()
      ? body.batchId.trim().slice(0, 64)
      : null;
    const { jobId, pageCount } = await submitOcrJob({
      userId,
      apiKeyId: authResult.auth.method === "api-key" ? authResult.auth.apiKeyId ?? null : null,
      fileName,
      model,
      ocrModel,
      provider,
      settings,
      settingsPayload,
      postProcessingPayload,
      inputPreviews,
      prompt,
      sourcePreview,
      priority: requestedPriority,
      batchId: requestedBatchId,
      startedAtMs,
    });

    return NextResponse.json(
      { status: OcrJobStatus.PROCESSING, jobId, pageCount },
      { status: 202 },
    );
  } catch (error) {
    console.error("OCR processing error:", error);
    return handleApiError(error, { statusFor: pipelineStatusFor });
  }
}
