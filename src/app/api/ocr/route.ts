import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { ApiProviderSettings, getApiSettings } from "@/lib/settings-store";
import { seedPostProcessingMeta } from "@/lib/ocr/job-seed";
import { normalizeMistralEndpoint as normalizeMistralEndpointBase } from "@/lib/ocr/provider-normalization";
import { resolveMistralOcrModel } from "@/lib/ocr/providers/mistral";
import {
  normalizeOpenAICompatApiBase,
  normalizeOpenRouterApiBase,
} from "@/lib/ocr/providers/compat";
import { authenticateMutation, requireScope, withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { enforceProviderEndpointPolicy, normalizeProvider, ProviderKind } from "@/lib/endpoint-policy";
import { withOcrJobSlot } from "@/lib/ocr/job-control";
import { resolveOllamaHostEndpoint } from "@/lib/host-normalization";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import {
  AdvancedSettings,
  normalizeAdvancedSettings,
  PostProcessingSettings,
} from "@/lib/ocr/settings";
import { ApiRouteError, handleApiError, pipelineStatusFor } from "@/lib/api-error";
import {
  DEFAULT_MISTRAL_API_URL,
  DEFAULT_OPENAI_COMPAT_API_URL,
  DEFAULT_OPENROUTER_API_URL,
} from "@/lib/ocr/provider-config";
import {
  buildProgressMetadata,
  getModelCatalog,
  OLLAMA_DISCOVERY_FALLBACK_HOST,
  parseCheckpointPages,
  processOcrJobInBackground,
  resolveProvider,
  toJsonValue,
} from "@/lib/ocr/pipeline";

const normalizeMistralEndpoint = (raw: string) =>
  normalizeMistralEndpointBase(raw, DEFAULT_MISTRAL_API_URL);

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



// Ollama host helpers + model cache moved to src/lib/ocr/pipeline.ts.
// OLLAMA_DISCOVERY_FALLBACK_HOST is re-exported from there for use in
// normalizeProviderEndpoint below.

const MAX_STORED_PREVIEW_LENGTH = 1_500_000;
const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;
const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
const OCR_RATE_LIMIT_MAX = 6;


function normalizePreviewForHistory(preview: string): string | null {
  const trimmed = preview.trim();
  if (!trimmed.startsWith("data:image/")) {
    return null;
  }
  if (trimmed.length > MAX_STORED_PREVIEW_LENGTH) {
    return null;
  }
  return trimmed;
}

function normalizeProviderEndpoint(provider: ProviderKind, rawEndpoint: string): string {
  if (provider === "mistral") {
    return enforceProviderEndpointPolicy("mistral",
      normalizeMistralEndpoint(rawEndpoint || DEFAULT_MISTRAL_API_URL),
      DEFAULT_MISTRAL_API_URL);
  }
  if (provider === "openrouter") {
    return enforceProviderEndpointPolicy("openrouter",
      normalizeOpenRouterApiBase(rawEndpoint || DEFAULT_OPENROUTER_API_URL),
      DEFAULT_OPENROUTER_API_URL);
  }
  if (provider === "openai_compat") {
    return enforceProviderEndpointPolicy("openai_compat",
      normalizeOpenAICompatApiBase(rawEndpoint || DEFAULT_OPENAI_COMPAT_API_URL),
      DEFAULT_OPENAI_COMPAT_API_URL);
  }
  return enforceProviderEndpointPolicy("ollama",
    resolveOllamaHostEndpoint(rawEndpoint || OLLAMA_DISCOVERY_FALLBACK_HOST, OLLAMA_DISCOVERY_FALLBACK_HOST),
    OLLAMA_DISCOVERY_FALLBACK_HOST);
}

function normalizeAndValidateApiSettings(raw: ApiProviderSettings): ApiProviderSettings {
  const provider = normalizeProvider(raw.provider);
  return {
    provider,
    apiEndpoint: normalizeProviderEndpoint(provider, raw.apiEndpoint),
    apiKey: raw.apiKey?.trim() || "",
  };
}

// Runtime normalization for OpenAI-compatible / OpenRouter base URLs lives in
// src/lib/ocr/providers/compat.ts (imported above) so the runners can be unit-tested.


function sanitizePostProcessing(
  raw: Partial<PostProcessingSettings> | undefined
): PostProcessingSettings {
  const rawInstruction = typeof raw?.instruction === "string" ? raw.instruction.trim() : "";
  const outputFormat = raw?.outputFormat === "json" ? "json" : "markdown";
  const model = typeof raw?.model === "string" ? raw.model.trim() : "";
  const enabled = Boolean(raw?.enabled) && rawInstruction.length > 0;

  return {
    enabled,
    instruction: rawInstruction.slice(0, MAX_POST_PROCESS_INSTRUCTION_LENGTH),
    outputFormat,
    model,
  };
}

// isLikelyMistralOcrModel + resolveMistralOcrModel moved to src/lib/ocr/providers/mistral.ts.

// parsePreviewImageData, getStringField, parseServiceError moved to
// src/lib/ocr/error-parsing.ts (imported above) for unit testability.

function buildPrompt(settings: AdvancedSettings): string {
  const languageInstruction =
    settings.language !== "auto"
      ? `The document is in ${settings.language}. Please transcribe in that language.`
      : "Detect the document language automatically.";

  const tableInstruction = settings.tableDetection
    ? "If there are tables, format them using markdown tables with proper column alignment."
    : "Extract table content as plain text.";

  const handwritingInstruction = settings.handwritingRecognition
    ? "Pay special attention to handwritten text and do your best to transcribe it accurately."
    : "Focus on printed text only.";

  const formattingInstruction = settings.preserveFormatting
    ? "Preserve the original formatting, layout, and structure as much as possible including spacing, indentation, and alignment."
    : "Extract text in a simplified format, focusing on content over formatting.";

  const customInstruction = settings.customPrompt
    ? `\n\nAdditional instructions from user:\n${settings.customPrompt}`
    : "";

  return `You are an OCR (Optical Character Recognition) system. Extract all text from this document image.

Instructions:
1. Extract ALL text visible in the image
2. ${languageInstruction}
3. ${tableInstruction}
4. ${handwritingInstruction}
5. ${formattingInstruction}
6. Include any numbers, dates, and special characters exactly as shown
7. If text is unclear or illegible, indicate with [illegible]${customInstruction}

Quality focus: ${settings.quality}%

Return ONLY valid JSON with this exact shape:
{
  "markdown": "clean markdown text extracted from the image",
  "fields": {}
}

Rules:
- "markdown" is required and must contain the extracted OCR content.
- "fields" is optional but if present must be a JSON object.
- Do not wrap JSON in markdown code fences.`;
}


// parseResponseText + fetchWithTimeout + OcrStopRequestedError moved to
// src/lib/ocr/providers/shared.ts.
// getStringField + parseServiceError moved to src/lib/ocr/error-parsing.ts.



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

    const clientIp = getClientIpAddress(request);
    const rateLimitKey =
      auth.method === "api-key" && auth.apiKeyId
        ? `ocr:job:key:${auth.apiKeyId}`
        : `ocr:job:${userId}:${clientIp}`;
    const rateLimitMax =
      auth.method === "api-key" && auth.rateLimitPerMinute && auth.rateLimitPerMinute > 0
        ? auth.rateLimitPerMinute
        : OCR_RATE_LIMIT_MAX;
    const rateLimit = consumeRateLimit({
      key: rateLimitKey,
      max: rateLimitMax,
      windowMs: OCR_RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return handleApiError(
        new ApiRouteError("Too many OCR jobs requested. Please retry shortly.", 429),
        { headers: { "Retry-After": `${rateLimit.retryAfterSeconds}` } },
      );
    }

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

    const provider = resolveProvider(settings);
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
        progressPct:
          postProcessingPayload.enabled
            ? (startIndex / inputPreviews.length) * 85
            : (startIndex / inputPreviews.length) * 100,
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

    const initialMetadata = buildProgressMetadata({
      stage: "queued",
      message: "Queued for OCR",
      progressPct: 0,
      pageCount: inputPreviews.length,
      processedPages: 0,
      currentPage: null,
      etaSeconds: null,
      startedAt: startedAtIso,
      events: [
        {
          at: startedAtIso,
          stage: "queued",
          message: "Job created",
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
      checkpoints: [],
      postProcessing: seedPostProcessingMeta(postProcessingPayload, postProcessingPayload.model || model),
    });

    const requestedPriority = parseRequestPriority(body?.priority);
    const requestedBatchId = typeof body?.batchId === "string" && body.batchId.trim()
      ? body.batchId.trim().slice(0, 64)
      : null;
    const createdJob = await db.ocrJob.create({
      data: {
        userId,
        apiKeyId: authResult.auth.method === "api-key" ? authResult.auth.apiKeyId ?? null : null,
        status: OcrJobStatus.PROCESSING,
        priority: requestedPriority,
        batchId: requestedBatchId,
        fileName,
        sourcePreview,
        model,
        language: settingsPayload.language,
        tableDetection: settingsPayload.tableDetection,
        handwritingRecognition: settingsPayload.handwritingRecognition,
        preserveFormatting: settingsPayload.preserveFormatting,
        customPrompt: settingsPayload.customPrompt,
        quality: settingsPayload.quality,
        settingsSnapshot: toJsonValue({
          settings: settingsPayload,
          postProcessing: postProcessingPayload,
        }),
        prompt,
        metadata: toJsonValue(initialMetadata),
      },
      select: { id: true },
    });
    void withOcrJobSlot(requestedPriority, () =>
      processOcrJobInBackground({
        jobId: createdJob.id,
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
      })
    );

    return NextResponse.json(
      {
        status: OcrJobStatus.PROCESSING,
        jobId: createdJob.id,
        pageCount: inputPreviews.length,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("OCR processing error:", error);
    return handleApiError(error, { statusFor: pipelineStatusFor });
  }
}
