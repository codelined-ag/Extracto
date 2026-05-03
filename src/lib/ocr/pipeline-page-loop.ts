import { db } from "@/lib/db";
import {
  isOcrJobStopRequested,
  registerOcrJobAbortController,
  unregisterOcrJobAbortController,
} from "@/lib/ocr/job-control";
import { appendPageMarkdown } from "@/lib/ocr/markdown-routing";
import {
  appendProgressEvent,
  type OcrPageCheckpoint,
  type OcrProgressEvent,
  type OcrProgressMetadata,
  type ProgressSnapshotInput,
} from "@/lib/ocr/pipeline-progress";
import {
  toJsonValue,
  toPageCheckpoint,
  toPageRecord,
  toPageResultPayload,
  toStructuredPagePayload,
  type ProcessedPageOutput,
} from "@/lib/ocr/pipeline-result-builder";
import { runProviderOcr } from "@/lib/ocr/provider-dispatch";
import { OcrStopRequestedError } from "@/lib/ocr/providers/shared";
import type { ProviderKind } from "@/lib/api-types";
import type { ApiProviderSettings } from "@/lib/api-types";

export interface OrchestratorState {
  pageOutputs: ProcessedPageOutput[];
  checkpoints: OcrPageCheckpoint[];
  pageRecords: ReturnType<typeof toPageRecord>[];
  partialStructuredPages: ReturnType<typeof toStructuredPagePayload>[];
  partialPageResults: ReturnType<typeof toPageResultPayload>[];
  totalDurationMs: number;
  extractedTextSoFar: string;
  extractedChunkCount: number;
  progressEvents: OcrProgressEvent[];
  latestMetadata: OcrProgressMetadata;
  postProcessingMeta: OcrProgressMetadata["postProcessing"];
  usedOllamaModels: Set<string>;
}

export interface PageLoopDeps {
  jobId: string;
  provider: ProviderKind;
  settings: ApiProviderSettings;
  ocrModel: string;
  prompt: string;
  inputPreviews: string[];
  startIndex: number;
  snapshot: (snap: ProgressSnapshotInput) => OcrProgressMetadata;
  ocrPct: () => number;
  pauseAtCheckpoint: (stageMessage: string, eventMessage: string) => Promise<void>;
}

export interface PageLoopResult {
  paused: boolean;
}

export async function runOcrPages(
  state: OrchestratorState,
  deps: PageLoopDeps,
): Promise<PageLoopResult> {
  const { inputPreviews, startIndex } = deps;

  for (let index = startIndex; index < inputPreviews.length; index++) {
    if (await isOcrJobStopRequested(deps.jobId)) {
      await deps.pauseAtCheckpoint(
        "Stopped. Resume to continue from checkpoint.",
        `Stopped at ${state.pageOutputs.length}/${inputPreviews.length} page(s)`,
      );
      return { paused: true };
    }

    const pagePreview = inputPreviews[index];
    const pageNumber = index + 1;
    const pageStartMs = Date.now();

    state.progressEvents = appendProgressEvent(
      state.progressEvents,
      "ocr",
      `Running OCR on page ${pageNumber}/${inputPreviews.length}`,
    );

    let pageText = "";
    let pageStructured: Record<string, unknown> = { markdown: "" };
    let pageMetadata: Record<string, unknown> = {};
    const pageAbortController = new AbortController();
    registerOcrJobAbortController(deps.jobId, pageAbortController);
    try {
      ({ text: pageText, structured: pageStructured, metadata: pageMetadata } = await runProviderOcr(
        deps.provider,
        deps.settings,
        deps.ocrModel,
        deps.prompt,
        pagePreview,
        pageAbortController.signal,
      ));
    } catch (error) {
      if (error instanceof OcrStopRequestedError || (await isOcrJobStopRequested(deps.jobId))) {
        await deps.pauseAtCheckpoint(
          "Stopped during inference. Resume to continue from checkpoint.",
          `Stopped during page ${pageNumber}/${inputPreviews.length} at ${state.pageOutputs.length}/${inputPreviews.length} page(s)`,
        );
        return { paused: true };
      }
      throw error;
    } finally {
      unregisterOcrJobAbortController(deps.jobId, pageAbortController);
    }

    const durationMs = Date.now() - pageStartMs;
    state.totalDurationMs += durationMs;

    const completedPage: ProcessedPageOutput = {
      pageNumber,
      text: pageText,
      structured: pageStructured,
      metadata: pageMetadata,
      durationMs,
    };

    state.pageOutputs.push(completedPage);
    state.checkpoints.push(toPageCheckpoint(completedPage));
    state.pageRecords.push(toPageRecord(completedPage));
    state.partialStructuredPages.push(toStructuredPagePayload(completedPage));
    state.partialPageResults.push(toPageResultPayload(completedPage));

    ({ text: state.extractedTextSoFar, chunks: state.extractedChunkCount } = appendPageMarkdown(
      state.extractedTextSoFar,
      state.extractedChunkCount,
      completedPage,
    ));

    const averagePageMs = state.totalDurationMs / state.pageOutputs.length;
    const remainingPages = inputPreviews.length - state.pageOutputs.length;
    const etaSeconds =
      remainingPages > 0 ? Math.max(1, Math.round((averagePageMs * remainingPages) / 1000)) : 0;

    state.progressEvents = appendProgressEvent(
      state.progressEvents,
      "ocr",
      `Completed page ${pageNumber}/${inputPreviews.length} in ${Math.round(durationMs / 100) / 10}s`,
    );

    state.latestMetadata = deps.snapshot({
      stage: "ocr",
      message: `Completed page ${pageNumber}/${inputPreviews.length}`,
      progressPct: deps.ocrPct(),
      currentPage: pageNumber,
      etaSeconds,
    });

    await db.ocrJob.update({
      where: { id: deps.jobId },
      data: {
        extractedText: state.extractedTextSoFar,
        metadata: toJsonValue({ ...state.latestMetadata, pageRecords: state.pageRecords }),
      },
    });
  }

  return { paused: false };
}
