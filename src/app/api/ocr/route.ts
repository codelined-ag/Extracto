import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import type { ApiProviderSettings } from "@/lib/api-types";
import { getApiSettings } from "@/lib/ocr/settings-store";
import { normalizeMistralApiBase } from "@/lib/ocr/providers/mistral";
import {
  normalizeOpenAICompatApiBase,
  normalizeOpenRouterApiBase,
} from "@/lib/ocr/providers/compat";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { normalizeProvider, type ProviderKind } from "@/lib/api-types";
import { enforceProviderEndpointPolicy } from "@/lib/ocr/endpoint-policy";
import { getFallbackOllamaHost, resolveOllamaHostEndpoint } from "@/lib/ocr/host-normalization";
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
import { normalizePreviewForHistory } from "@/lib/ocr/job-input-helpers";
import { resumeOcrJob, submitOcrJob } from "@/lib/ocr/job-submit";
import { extractAnchorsForPages } from "@/lib/ocr/pdf-anchoring-helper";
import { getModelCatalog } from "@/lib/ocr/model-catalog";

interface OCRRequestBody {
  jobId?: unknown;
  resume?: unknown;
  fileName?: unknown;
  model?: unknown;
  preview?: unknown;
  pages?: unknown;
  pageNumbers?: unknown;
  sourcePdf?: unknown;
  priority?: unknown;
  batchId?: unknown;
  settings?: Partial<AdvancedSettings>;
  postProcessing?: Partial<PostProcessingSettings>;
}

function parseRequestPriority(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-10, Math.min(10, Math.trunc(value)));
}

interface ProviderEndpointAdapter {
  normalize: (raw: string) => string;
  getDefault: () => string;
}

const ENDPOINT_ADAPTERS: Record<ProviderKind, ProviderEndpointAdapter> = {
  mistral: { normalize: normalizeMistralApiBase, getDefault: getDefaultMistralApiUrl },
  openrouter: { normalize: normalizeOpenRouterApiBase, getDefault: getDefaultOpenRouterApiUrl },
  openai_compat: { normalize: normalizeOpenAICompatApiBase, getDefault: getDefaultOpenAICompatApiUrl },
  ollama: {
    normalize: (raw) => resolveOllamaHostEndpoint(raw, getFallbackOllamaHost()),
    getDefault: getFallbackOllamaHost,
  },
};

function normalizeProviderEndpoint(provider: ProviderKind, rawEndpoint: string): string {
  const adapter = ENDPOINT_ADAPTERS[provider];
  const fallback = adapter.getDefault();
  return enforceProviderEndpointPolicy(provider, adapter.normalize(rawEndpoint || fallback), fallback);
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

    let pageNumbers: number[] | undefined;
    if (Array.isArray(body.pageNumbers)) {
      const cleaned = body.pageNumbers.filter(
        (p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 10_000,
      );
      if (cleaned.length !== body.pageNumbers.length) {
        throw new ApiRouteError("pageNumbers must be a list of positive integers (1-indexed)", 400);
      }
      if (cleaned.length !== inputPreviews.length) {
        throw new ApiRouteError(
          `pageNumbers length (${cleaned.length}) must equal inputPreviews length (${inputPreviews.length})`,
          400,
        );
      }
      if (new Set(cleaned).size !== cleaned.length) {
        throw new ApiRouteError("pageNumbers must not contain duplicates", 400);
      }
      for (let i = 1; i < cleaned.length; i++) {
        if (cleaned[i] <= cleaned[i - 1]) {
          throw new ApiRouteError("pageNumbers must be strictly ascending", 400);
        }
      }
      pageNumbers = cleaned;
    }

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
    const sourcePdfRaw = typeof body.sourcePdf === "string" ? body.sourcePdf.trim() : "";
    const pageAnchors = await extractAnchorsForPages(
      sourcePdfRaw || undefined,
      pageNumbers,
      inputPreviews.length,
    );

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
        pageNumbers,
        pageAnchors,
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
      pageNumbers,
      pageAnchors,
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
