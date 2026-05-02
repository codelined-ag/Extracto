// OCR pipeline — the entire background-job orchestrator extracted from
// src/app/api/ocr/route.ts so the route file is just an HTTP shell.
//
// What's in here:
//  - Progress + checkpoint types and helpers
//  - Post-processing prompt + response normalization helpers
//  - Result-builder (buildJsonResult + computeTextStats + formatPageScopedText)
//  - Ollama host-resolution + model-discovery + thin route-level Ollama wrappers
//  - Provider dispatch (PROVIDER_HANDLERS, runProviderOcr, runProviderPostProcessing)
//  - Persistence + finalization (persistCompletedJob, persistFailedJob, finalizeOcrJob)
//  - The orchestrator itself (processOcrJobInBackground)
//  - parseCheckpointPages + getModelCatalog
//
// What stays in route.ts:
//  - GET / POST handlers and their direct request validation
//  - normalizeAndValidateApiSettings, normalizeProviderEndpoint
//  - sanitizePostProcessing, normalizePreviewForHistory
//  - parseRequestPriority
//  - buildPrompt (OCR per-page system prompt)

import { OcrJobStatus, Prisma } from "@prisma/client";

import { ApiRouteError, errorMessage } from "@/lib/api-error";
import { dispatchJobWebhooks } from "@/lib/background/webhooks";
import { db } from "@/lib/db";
import {
  type ProviderKind,
} from "@/lib/ocr/endpoint-policy";
import {
  clearOcrJobRunning,
  clearOcrJobStop,
  markOcrJobRunning,
  withOcrJobSlot,
} from "@/lib/ocr/job-control";
import {
  seedExtractedText,
  seedPostProcessingMeta,
  seedUsedOllamaModels,
} from "@/lib/ocr/job-seed";
import {
  getDefaultOpenAICompatApiUrl,
  getDefaultOpenAICompatFallbackModels,
  getDefaultOpenRouterApiUrl,
  getDefaultOpenRouterFallbackModels,
} from "@/lib/ocr/provider-config";
import {
  discoverCompatModels,
  OPENAI_COMPAT_CONFIG,
  OPENROUTER_CONFIG,
} from "@/lib/ocr/providers/compat";
import {
  listMistralModels,
} from "@/lib/ocr/providers/mistral";
import {
  type AdvancedSettings,
  type PostProcessingSettings,
} from "@/lib/ocr/settings";
import {
  maybeUploadResultJson,
  maybeUploadResultText,
} from "@/lib/ocr/result-store";
import {
  type ApiProviderSettings,
} from "@/lib/ocr/settings-store";

// ---- Types --------------------------------------------------------------

export interface OcrPage {
  index?: number;
  markdown?: string;
  text?: string;
  html?: string;
}

export interface ModelCatalog {
  ollama: string[];
  mistral: string[];
  openrouter: string[];
  openai_compat: string[];
}

import type {
  OcrPageCheckpoint,
  OcrProgressEvent,
  OcrProgressMetadata,
  OcrProgressStage,
} from "@/lib/ocr/pipeline-progress";
import {
  appendProgressEvent,
  buildProgressMetadata,
  createProgressSnapshotter,
  ocrStageProgressPct,
} from "@/lib/ocr/pipeline-progress";
import type {
  OcrJsonResult,
  ProcessedPageOutput,
} from "@/lib/ocr/pipeline-result-builder";
import {
  buildJsonResult,
  toJsonValue,
  toPageCheckpoint,
  toPageRecord,
  toPageResultPayload,
  toStructuredPagePayload,
} from "@/lib/ocr/pipeline-result-builder";
import {
  buildPostProcessingPrompt,
  computeTextStats,
  formatPageScopedText,
  normalizePostProcessedText,
} from "@/lib/ocr/pipeline-post-processing";

export type {
  OcrPageCheckpoint,
  OcrProgressEvent,
  OcrProgressMetadata,
  OcrProgressStage,
  OcrJsonResult,
  ProcessedPageOutput,
};
export {
  appendProgressEvent,
  buildProgressMetadata,
  buildJsonResult,
  toJsonValue,
  buildPostProcessingPrompt,
  computeTextStats,
  formatPageScopedText,
  normalizePostProcessedText,
};

export interface ProcessOcrJobInput {
  jobId: string;
  startedAtMs: number;
  fileName: string;
  model: string;
  ocrModel: string;
  provider: ProviderKind;
  settings: ApiProviderSettings;
  settingsPayload: AdvancedSettings;
  postProcessingPayload: PostProcessingSettings;
  inputPreviews: string[];
  prompt: string;
  initialPageOutputs?: ProcessedPageOutput[];
  startIndex?: number;
  resumed?: boolean;
}

import {
  getOllamaCandidatesForOcr,
  getOllamaDiscoveryFallbackHost,
  getOllamaModels,
  ollamaOcrWithHostResolve,
  ollamaPostProcessingWithHostResolve,
  ollamaUnloadWithHostResolve,
  ollamaWarmupWithHostResolve,
} from "@/lib/ocr/ollama-dispatch";

export {
  getOllamaCandidatesForOcr,
  getOllamaDiscoveryFallbackHost,
  getOllamaModels,
  ollamaOcrWithHostResolve,
  ollamaPostProcessingWithHostResolve,
  ollamaUnloadWithHostResolve,
  ollamaWarmupWithHostResolve,
};

import { runProviderOcr, runProviderPostProcessing } from "@/lib/ocr/provider-dispatch";
export { runProviderOcr, runProviderPostProcessing };

import { runOcrPages, type OrchestratorState } from "@/lib/ocr/pipeline-page-loop";
import { runPostProcessingStage } from "@/lib/ocr/pipeline-post-processing-stage";


// ---- Persistence + finalization -----------------------------------------

async function unloadAllOllamaModels(apiEndpoint: string, models: Set<string>): Promise<void> {
  for (const model of models) {
    await ollamaUnloadWithHostResolve(apiEndpoint, model);
  }
}

async function finalizeOcrJob(
  jobId: string,
  apiEndpoint: string,
  usedOllamaModels: Set<string>,
): Promise<void> {
  await unloadAllOllamaModels(apiEndpoint, usedOllamaModels);
  clearOcrJobRunning(jobId);
  await clearOcrJobStop(jobId);
}

/**
 * Persist a successful OCR job: offload large artifacts (text + JSON
 * result) to the result store, write the COMPLETED row, dispatch the
 * job.completed webhook, then finalize (unload Ollama models, clear
 * running/stop flags).
 */
async function persistCompletedJob(
  input: ProcessOcrJobInput,
  finalMarkdown: string,
  result: unknown,
  extractedMetadata: Record<string, unknown>,
  usedOllamaModels: Set<string>,
): Promise<void> {
  const [extractedTextOffload, resultOffload] = await Promise.all([
    maybeUploadResultText(input.jobId, finalMarkdown),
    maybeUploadResultJson(input.jobId, result),
  ]);

  await db.ocrJob.update({
    where: { id: input.jobId },
    data: {
      status: OcrJobStatus.COMPLETED,
      extractedText: extractedTextOffload.inline,
      extractedTextLocation: extractedTextOffload.location,
      result: (resultOffload.inline ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      resultLocation: resultOffload.location,
      metadata: toJsonValue(extractedMetadata),
      completedAt: new Date(),
      processingMs: Date.now() - input.startedAtMs,
    },
  });
  void dispatchJobWebhooks(input.jobId, "job.completed").catch(() => undefined);
  await finalizeOcrJob(input.jobId, input.settings.apiEndpoint, usedOllamaModels);
}

/** Mirror of persistCompletedJob for the failure path. */
async function persistFailedJob(
  input: ProcessOcrJobInput,
  errorText: string,
  metadata: OcrProgressMetadata,
  usedOllamaModels: Set<string>,
): Promise<void> {
  await db.ocrJob.update({
    where: { id: input.jobId },
    data: {
      status: OcrJobStatus.FAILED,
      metadata: toJsonValue(metadata),
      errorMessage: errorText,
      completedAt: new Date(),
      processingMs: Date.now() - input.startedAtMs,
    },
  });
  void dispatchJobWebhooks(input.jobId, "job.failed").catch(() => undefined);
  await finalizeOcrJob(input.jobId, input.settings.apiEndpoint, usedOllamaModels);
}

// ---- The orchestrator ---------------------------------------------------

export async function processOcrJobInBackground(input: ProcessOcrJobInput): Promise<void> {
  const startedAtIso = new Date(input.startedAtMs).toISOString();
  const startIndex = Math.max(0, Math.min(input.startIndex ?? 0, input.inputPreviews.length));
  const selectedPostProcessModel = input.postProcessingPayload.model || input.model;

  const initialPages: ProcessedPageOutput[] = input.initialPageOutputs ? [...input.initialPageOutputs] : [];
  const seededText = seedExtractedText(initialPages);

  const state: OrchestratorState = {
    pageOutputs: initialPages,
    checkpoints: initialPages.map(toPageCheckpoint),
    pageRecords: initialPages.map(toPageRecord),
    partialStructuredPages: initialPages.map(toStructuredPagePayload),
    partialPageResults: initialPages.map(toPageResultPayload),
    totalDurationMs: initialPages.reduce((sum, page) => sum + page.durationMs, 0),
    extractedTextSoFar: seededText.text,
    extractedChunkCount: seededText.chunks,
    progressEvents: [],
    latestMetadata: {} as OcrProgressMetadata,
    postProcessingMeta: seedPostProcessingMeta(input.postProcessingPayload, selectedPostProcessModel),
    usedOllamaModels: seedUsedOllamaModels(input.provider, input.ocrModel),
  };

  state.progressEvents = appendProgressEvent(
    state.progressEvents,
    "analyzing",
    input.resumed
      ? `Resuming from page ${startIndex + 1}/${input.inputPreviews.length}`
      : `Document analyzed: ${input.inputPreviews.length} page(s) ready`,
  );
  if (input.provider === "mistral" && input.ocrModel !== input.model) {
    state.progressEvents = appendProgressEvent(
      state.progressEvents,
      "analyzing",
      `Using ${input.ocrModel} for OCR and ${input.model} for inference`,
    );
  }

  const snapshotMetadata = createProgressSnapshotter({
    pageCount: input.inputPreviews.length,
    startedAt: startedAtIso,
    getProcessedPages: () => state.pageOutputs.length,
    getEvents: () => state.progressEvents,
    getCheckpoints: () => state.checkpoints,
    getPostProcessing: () => state.postProcessingMeta,
  });
  const ocrPct = (): number =>
    ocrStageProgressPct(state.pageOutputs.length, input.inputPreviews.length, input.postProcessingPayload.enabled);

  state.latestMetadata = snapshotMetadata({
    stage: "analyzing",
    message: input.resumed
      ? `Resuming OCR from checkpoint (${state.pageOutputs.length}/${input.inputPreviews.length} pages complete)`
      : `Prepared ${input.inputPreviews.length} page(s) for OCR`,
    progressPct: 2,
  });

  const pauseAtCheckpoint = async (stageMessage: string, eventMessage: string): Promise<void> => {
    state.progressEvents = appendProgressEvent(state.progressEvents, "paused", eventMessage);
    state.latestMetadata = snapshotMetadata({
      stage: "paused",
      message: stageMessage,
      progressPct: ocrPct(),
    });

    await unloadAllOllamaModels(input.settings.apiEndpoint, state.usedOllamaModels);

    await db.ocrJob.update({
      where: { id: input.jobId },
      data: {
        status: OcrJobStatus.QUEUED,
        metadata: toJsonValue({ ...state.latestMetadata, pageRecords: state.pageRecords }),
        processingMs: Date.now() - input.startedAtMs,
      },
    });
    clearOcrJobRunning(input.jobId);
    await clearOcrJobStop(input.jobId);
  };

  try {
    await clearOcrJobStop(input.jobId);
    markOcrJobRunning(input.jobId);
    if (input.provider === "ollama") {
      await ollamaWarmupWithHostResolve(input.settings.apiEndpoint, input.ocrModel);
    }

    const loop = await runOcrPages(state, {
      jobId: input.jobId,
      provider: input.provider,
      settings: input.settings,
      ocrModel: input.ocrModel,
      prompt: input.prompt,
      inputPreviews: input.inputPreviews,
      startIndex,
      snapshot: snapshotMetadata,
      ocrPct,
      pauseAtCheckpoint,
    });
    if (loop.paused) return;

    const extractedMarkdown = state.extractedTextSoFar.trim();
    if (!extractedMarkdown) {
      throw new ApiRouteError("OCR returned no text", 502);
    }

    const pageScopedText = formatPageScopedText(state.pageOutputs);
    const extractedMetadata: Record<string, unknown> = {
      ocrModel: input.ocrModel,
      inferenceModel: input.model,
      pageCount: input.inputPreviews.length,
      pageResults: state.partialPageResults,
    };

    const postProcessing = await runPostProcessingStage(state, {
      jobId: input.jobId,
      settings: input.settings,
      postProcessingPayload: input.postProcessingPayload,
      postProcessingModel: selectedPostProcessModel,
      pageScopedText,
      extractedMarkdown,
      snapshot: snapshotMetadata,
    });
    const finalMarkdown = postProcessing.finalMarkdown;
    const postProcessedText = postProcessing.postProcessedText;
    const postProcessedJson = postProcessing.postProcessedJson;
    extractedMetadata.postProcessing = postProcessing.postProcessingForExtractedMetadata;

    const result = buildJsonResult(
      input.fileName,
      input.model,
      input.provider,
      input.settingsPayload,
      finalMarkdown,
      {
        markdown: finalMarkdown,
        rawMarkdown: extractedMarkdown,
        pages: state.partialStructuredPages,
        ...(postProcessedText
          ? {
              postProcessingOutput:
                input.postProcessingPayload.outputFormat === "json"
                  ? {
                      json: postProcessedJson ?? null,
                      rawText: postProcessedText,
                    }
                  : { markdown: postProcessedText },
            }
          : {}),
      },
      extractedMetadata,
    );
    result.rawExtractionText = extractedMarkdown;
    if (postProcessedText) {
      result.postProcessedText = postProcessedText;
    }
    if (postProcessedJson !== undefined) {
      extractedMetadata.postProcessingJson = postProcessedJson;
    }

    state.progressEvents = appendProgressEvent(state.progressEvents, "completed", "OCR job completed");
    state.latestMetadata = snapshotMetadata({
      stage: "completed",
      message: "Completed",
      progressPct: 100,
      etaSeconds: 0,
    });
    extractedMetadata.progress = state.latestMetadata;

    await persistCompletedJob(input, finalMarkdown, result, extractedMetadata, state.usedOllamaModels);
  } catch (error) {
    state.progressEvents = appendProgressEvent(
      state.progressEvents,
      "failed",
      errorMessage(error, "OCR processing failed"),
    );
    state.latestMetadata = snapshotMetadata({
      stage: "failed",
      message: errorMessage(error, "OCR processing failed"),
      progressPct: state.latestMetadata.progressPct ?? 0,
    });

    await persistFailedJob(
      input,
      errorMessage(error, "OCR processing failed"),
      state.latestMetadata,
      state.usedOllamaModels,
    );
  }
}

// ---- Checkpoint resume helper -------------------------------------------

export function parseCheckpointPages(result: unknown, metadata?: unknown): ProcessedPageOutput[] {
  const rawCheckpointPages =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as { pageRecords?: unknown }).pageRecords
      : undefined;
  const fromResult = result && typeof result === "object" && !Array.isArray(result)
    ? (result as { metadata?: { pageRecords?: unknown } }).metadata?.pageRecords
    : undefined;
  const checkpointSource = Array.isArray(rawCheckpointPages) ? rawCheckpointPages : fromResult;

  if (!Array.isArray(checkpointSource)) {
    return [];
  }

  return checkpointSource
    .map((page) => {
      if (!page || typeof page !== "object" || Array.isArray(page)) return null;
      const typed = page as {
        pageNumber?: unknown;
        text?: unknown;
        structured?: unknown;
        durationMs?: unknown;
        metadata?: unknown;
      };
      if (typeof typed.pageNumber !== "number" || typeof typed.text !== "string") return null;
      return {
        pageNumber: typed.pageNumber,
        text: typed.text,
        structured:
          typed.structured && typeof typed.structured === "object" && !Array.isArray(typed.structured)
            ? (typed.structured as Record<string, unknown>)
            : { markdown: typed.text },
        durationMs: typeof typed.durationMs === "number" ? typed.durationMs : 0,
        metadata:
          typed.metadata && typeof typed.metadata === "object" && !Array.isArray(typed.metadata)
            ? (typed.metadata as Record<string, unknown>)
            : {},
      };
    })
    .filter((page): page is ProcessedPageOutput => Boolean(page))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

// ---- Model catalog (for GET /api/ocr) -----------------------------------

async function tryDiscover(discover: () => Promise<string[]>, label: string): Promise<string[]> {
  try {
    return await discover();
  } catch (error) {
    console.error(`Failed to fetch ${label}:`, error);
    return [];
  }
}

export async function getModelCatalog(settings: ApiProviderSettings): Promise<ModelCatalog> {
  const mistralModels = listMistralModels();

  const ollamaModels = await tryDiscover(
    () => getOllamaModels(settings.apiEndpoint).then((r) => r.models),
    "Ollama model catalog",
  );

  const openRouterEndpoint =
    settings.provider === "openrouter" ? settings.apiEndpoint : getDefaultOpenRouterApiUrl();
  const openRouterKey =
    settings.provider === "openrouter"
      ? settings.apiKey || process.env.OPENROUTER_API_KEY || ""
      : process.env.OPENROUTER_API_KEY || "";
  const openRouterModels = openRouterKey
    ? await tryDiscover(
        () => discoverCompatModels(OPENROUTER_CONFIG, openRouterEndpoint, openRouterKey),
        "OpenRouter model catalog",
      )
    : [];
  const resolvedOpenRouterModels =
    openRouterModels.length === 0 && settings.provider === "openrouter"
      ? [...getDefaultOpenRouterFallbackModels()]
      : openRouterModels;

  const openAICompatEndpoint =
    settings.provider === "openai_compat" ? settings.apiEndpoint : getDefaultOpenAICompatApiUrl();
  const openAICompatKey =
    settings.provider === "openai_compat"
      ? settings.apiKey || process.env.OPENAI_COMPAT_API_KEY || ""
      : process.env.OPENAI_COMPAT_API_KEY || "";
  const openAICompatModels = openAICompatKey
    ? await tryDiscover(
        () => discoverCompatModels(OPENAI_COMPAT_CONFIG, openAICompatEndpoint, openAICompatKey),
        "OpenAI-compatible model catalog",
      )
    : [];
  const resolvedOpenAICompatModels =
    openAICompatModels.length === 0 && settings.provider === "openai_compat"
      ? [...getDefaultOpenAICompatFallbackModels()]
      : openAICompatModels;

  return {
    ollama: ollamaModels,
    mistral: mistralModels,
    openrouter: resolvedOpenRouterModels,
    openai_compat: resolvedOpenAICompatModels,
  };
}

// ---- Input normalization helpers ----------------------------------------
// Used by /api/ocr POST and /api/v1/ocr/batch to prepare a raw body into
// the inputs submitOcrJob needs.

const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;

export function sanitizePostProcessing(
  raw: Partial<PostProcessingSettings> | undefined,
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

const MAX_STORED_PREVIEW_LENGTH = 1_500_000;

export function normalizePreviewForHistory(preview: string): string | null {
  const trimmed = preview.trim();
  if (!trimmed.startsWith("data:image/")) return null;
  if (trimmed.length > MAX_STORED_PREVIEW_LENGTH) return null;
  return trimmed;
}

export function buildPrompt(settings: AdvancedSettings): string {
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

// ---- Job submission helper ---------------------------------------------
// Used by /api/ocr POST and by /api/v1/ocr/batch and the OpenAI-compat
// adapter so the latter two don't need to HTTP-loopback through /api/ocr.
// Callers do their own body validation; this helper takes already-normalized
// inputs, persists the job row, and kicks off processOcrJobInBackground.

export interface SubmitOcrJobInput {
  userId: string;
  apiKeyId: string | null;
  fileName: string;
  model: string;
  ocrModel: string;
  provider: ProviderKind;
  settings: ApiProviderSettings;
  settingsPayload: AdvancedSettings;
  postProcessingPayload: PostProcessingSettings;
  inputPreviews: string[];
  prompt: string;
  sourcePreview: string | null;
  priority?: number;
  batchId?: string | null;
  startedAtMs?: number;
}

export async function submitOcrJob(
  input: SubmitOcrJobInput,
): Promise<{ jobId: string; pageCount: number }> {
  const startedAtMs = input.startedAtMs ?? Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const priority = input.priority ?? 0;

  const initialMetadata = buildProgressMetadata({
    stage: "queued",
    message: "Queued for OCR",
    progressPct: 0,
    pageCount: input.inputPreviews.length,
    processedPages: 0,
    currentPage: null,
    etaSeconds: null,
    startedAt: startedAtIso,
    events: [
      { at: startedAtIso, stage: "queued", message: "Job created" },
      ...(input.provider === "mistral" && input.ocrModel !== input.model
        ? [
            {
              at: startedAtIso,
              stage: "queued" as const,
              message: `OCR will use ${input.ocrModel}; selected inference model is ${input.model}`,
            },
          ]
        : []),
    ],
    checkpoints: [],
    postProcessing: seedPostProcessingMeta(
      input.postProcessingPayload,
      input.postProcessingPayload.model || input.model,
    ),
  });

  const createdJob = await db.ocrJob.create({
    data: {
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      status: OcrJobStatus.PROCESSING,
      priority,
      batchId: input.batchId ?? null,
      fileName: input.fileName,
      sourcePreview: input.sourcePreview,
      model: input.model,
      language: input.settingsPayload.language,
      tableDetection: input.settingsPayload.tableDetection,
      handwritingRecognition: input.settingsPayload.handwritingRecognition,
      preserveFormatting: input.settingsPayload.preserveFormatting,
      customPrompt: input.settingsPayload.customPrompt,
      quality: input.settingsPayload.quality,
      settingsSnapshot: toJsonValue({
        settings: input.settingsPayload,
        postProcessing: input.postProcessingPayload,
      }),
      prompt: input.prompt,
      metadata: toJsonValue(initialMetadata),
    },
    select: { id: true },
  });

  void withOcrJobSlot(priority, () =>
    processOcrJobInBackground({
      jobId: createdJob.id,
      startedAtMs,
      fileName: input.fileName,
      model: input.model,
      ocrModel: input.ocrModel,
      provider: input.provider,
      settings: input.settings,
      settingsPayload: input.settingsPayload,
      postProcessingPayload: input.postProcessingPayload,
      inputPreviews: input.inputPreviews,
      prompt: input.prompt,
    }),
  );

  return { jobId: createdJob.id, pageCount: input.inputPreviews.length };
}
