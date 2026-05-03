import { OcrJobStatus, Prisma } from "@prisma/client";

import { ApiRouteError, errorMessage } from "@/lib/api-error";
import type { ApiProviderSettings, ProviderKind } from "@/lib/api-types";
import { dispatchJobWebhooks } from "@/lib/background/webhooks";
import { db } from "@/lib/db";
import {
  clearOcrJobRunning,
  clearOcrJobStop,
  markOcrJobRunning,
} from "@/lib/ocr/job-control";
import {
  seedExtractedText,
  seedPostProcessingMeta,
  seedUsedOllamaModels,
} from "@/lib/ocr/job-seed";
import { getOllamaCandidatesForOcr } from "@/lib/ocr/ollama-dispatch";
import { runOcrPages, type OrchestratorState } from "@/lib/ocr/pipeline-page-loop";
import {
  formatPageScopedText,
} from "@/lib/ocr/pipeline-post-processing";
import { runPostProcessingStage } from "@/lib/ocr/pipeline-post-processing-stage";
import {
  appendProgressEvent,
  createProgressSnapshotter,
  ocrStageProgressPct,
  type OcrProgressMetadata,
} from "@/lib/ocr/pipeline-progress";
import {
  buildJsonResult,
  toJsonValue,
  toPageCheckpoint,
  toPageRecord,
  toPageResultPayload,
  toStructuredPagePayload,
  type ProcessedPageOutput,
} from "@/lib/ocr/pipeline-result-builder";
import { unloadOllamaModel, warmupOllamaModel } from "@/lib/ocr/providers/ollama";
import { OcrStopRequestedError } from "@/lib/ocr/providers/shared";
import {
  maybeUploadResultJson,
  maybeUploadResultText,
} from "@/lib/ocr/result-store";
import type {
  AdvancedSettings,
  PostProcessingSettings,
} from "@/lib/ocr/settings";

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
  pageNumbers?: number[];
  pageAnchors?: import("@/lib/ocr/pdf-anchoring").AnchorPage[];
  prompt: string;
  initialPageOutputs?: ProcessedPageOutput[];
  startIndex?: number;
  resumed?: boolean;
}


// ---- Persistence + finalization -----------------------------------------

async function unloadAllOllamaModels(apiEndpoint: string, models: Set<string>): Promise<void> {
  const hosts = getOllamaCandidatesForOcr(apiEndpoint);
  for (const model of models) {
    await unloadOllamaModel(hosts, model);
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
      ? `Resuming from page ${input.pageNumbers?.[startIndex] ?? startIndex + 1}/${input.inputPreviews.length}`
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
      await warmupOllamaModel(getOllamaCandidatesForOcr(input.settings.apiEndpoint), input.ocrModel);
    }

    const loop = await runOcrPages(state, {
      jobId: input.jobId,
      provider: input.provider,
      settings: input.settings,
      ocrModel: input.ocrModel,
      prompt: input.prompt,
      inputPreviews: input.inputPreviews,
      pageNumbers: input.pageNumbers,
      pageAnchors: input.pageAnchors,
      preferTextLayer: input.settingsPayload.preferTextLayer,
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

    const result = buildJsonResult({
      fileName: input.fileName,
      model: input.model,
      provider: input.provider,
      settings: input.settingsPayload,
      markdown: finalMarkdown,
      structured: {
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
      metadata: extractedMetadata,
    });
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
    if (error instanceof OcrStopRequestedError) {
      await pauseAtCheckpoint(
        "Stopped during post-processing. Resume to continue.",
        `Stopped during post-processing (${state.pageOutputs.length}/${input.inputPreviews.length} page(s) complete)`,
      );
      return;
    }
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
