import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { ApiProviderSettings, getApiSettings } from "@/lib/ocr/settings-store";
import { normalizeMistralApiBase } from "@/lib/ocr/providers/mistral";
import {
  normalizeOpenAICompatApiBase,
  normalizeOpenRouterApiBase,
} from "@/lib/ocr/providers/compat";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { enforceProviderEndpointPolicy, normalizeProvider, ProviderKind } from "@/lib/ocr/endpoint-policy";
import { resolveOllamaHostEndpoint } from "@/lib/ocr/host-normalization";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import {
  AdvancedSettings,
  PostProcessingSettings,
} from "@/lib/ocr/settings";
import { ApiRouteError, handleApiError, pipelineStatusFor } from "@/lib/api-error";
import {
  getDefaultMistralApiUrl,
  getDefaultOpenAICompatApiUrl,
  getDefaultOpenRouterApiUrl,
} from "@/lib/ocr/provider-config";
import {
  getModelCatalog,
  normalizePreviewForHistory,
  getOllamaDiscoveryFallbackHost,
  resumeOcrJob,
  submitOcrJob,
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

export const POST = withMutationAuth("ocr:submit", async (request: NextRequest, { auth }) => {
  const startedAtMs = Date.now();
  try {
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

    if (!model) {
      throw new ApiRouteError("Model is required", 400);
    }

    if (inputPreviews.length === 0) {
      throw new ApiRouteError("No image preview provided", 400);
    }

    const resumeRequested = body.resume === true || body.resume === "true";
    const resumeJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

    const inputs = await resolveOcrJobInputs({
      userId,
      model,
      perRequestSettings: body.settings,
      perRequestPostProcessing: body.postProcessing,
      preloadedSettings: storedSettings,
    });
    const sourcePreview = normalizePreviewForHistory(inputPreviews[0] || "");

    if (resumeRequested) {
      if (!resumeJobId) {
        throw new ApiRouteError("jobId is required when resume=true", 400);
      }

      const { jobId, pageCount, pageRecords } = await resumeOcrJob({
        ...inputs,
        jobId: resumeJobId,
        userId,
        apiKeyId: auth.method === "api-key" ? auth.apiKeyId ?? null : null,
        fileName,
        model,
        inputPreviews,
        sourcePreview,
        startedAtMs,
      });

      return NextResponse.json(
        {
          status: OcrJobStatus.PROCESSING,
          jobId,
          pageCount,
          resumed: true,
          pageRecords,
        },
        { status: 202 }
      );
    }

    const requestedPriority = parseRequestPriority(body?.priority);
    const requestedBatchId = typeof body?.batchId === "string" && body.batchId.trim()
      ? body.batchId.trim().slice(0, 64)
      : null;
    const { jobId, pageCount } = await submitOcrJob({
      ...inputs,
      userId,
      apiKeyId: auth.method === "api-key" ? auth.apiKeyId ?? null : null,
      fileName,
      model,
      inputPreviews,
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
    return handleApiError(error, { statusFor: pipelineStatusFor });
  }
});
