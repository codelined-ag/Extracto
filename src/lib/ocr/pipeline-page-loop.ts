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
import { effectiveMaxAttempts, withProviderRetry } from "@/lib/ocr/retry";
import type { ProviderKind } from "@/lib/api-types";
import type { ApiProviderSettings } from "@/lib/api-types";
import type { AnchorPage } from "@/lib/ocr/pdf-anchoring";
import { assessTextLayerQuality } from "@/lib/ocr/pdf-anchoring";
import { maybeApplyAnchoring } from "@/lib/ocr/anchoring-prompt";
import { extractMarkdownFromTextLayer } from "@/lib/ocr/text-layer-extraction";
import { PAGE_CONCURRENCY_MAX, PAGE_CONCURRENCY_MIN } from "@/lib/ocr/settings";

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
  pageNumbers?: number[];
  pageAnchors?: AnchorPage[];
  preferTextLayer?: boolean;
  documentPresetExpectsJson?: boolean;
  pageConcurrency?: number;
  autoRetryMaxAttempts?: number;
  startIndex: number;
  snapshot: (snap: ProgressSnapshotInput) => OcrProgressMetadata;
  ocrPct: () => number;
  pauseAtCheckpoint: (stageMessage: string, eventMessage: string) => Promise<void>;
}

export interface PageLoopResult {
  paused: boolean;
}

interface PageRunSuccess {
  index: number;
  output: ProcessedPageOutput;
  startedAt: number;
}

async function runOnePage(
  state: OrchestratorState,
  deps: PageLoopDeps,
  index: number,
): Promise<PageRunSuccess> {
  const pagePreview = deps.inputPreviews[index];
  const pageNumber = deps.pageNumbers?.[index] ?? index + 1;
  const startedAt = Date.now();
  const anchor = deps.pageAnchors?.[index];
  const quality = anchor ? assessTextLayerQuality(anchor) : null;
  const useFastPath = Boolean(
    deps.preferTextLayer &&
      anchor &&
      quality?.isHighConfidence &&
      !deps.documentPresetExpectsJson,
  );
  const anchorIsTrustworthy = Boolean(quality && !quality.isLikelyJunkOcr && !quality.isLikelyImageOnly);
  const anchored = useFastPath
    ? { prompt: deps.prompt, usedAnchoring: false }
    : maybeApplyAnchoring(deps.prompt, anchorIsTrustworthy ? anchor : undefined, {
        skipForJsonPreset: deps.documentPresetExpectsJson,
      });
  const effectivePrompt = anchored.prompt;

  state.progressEvents = appendProgressEvent(
    state.progressEvents,
    "ocr",
    useFastPath
      ? `Running text-layer fast-path on page ${pageNumber}/${deps.inputPreviews.length} (no VLM call)`
      : `Running OCR on page ${pageNumber}/${deps.inputPreviews.length}${anchored.usedAnchoring ? " (with text-layer anchoring)" : ""}`,
  );

  let pageText = "";
  let pageStructured: Record<string, unknown> = { markdown: "" };
  let pageMetadata: Record<string, unknown> = {};
  const abortController = new AbortController();
  registerOcrJobAbortController(deps.jobId, abortController);
  try {
    if (useFastPath && anchor) {
      const extracted = extractMarkdownFromTextLayer(anchor);
      pageText = extracted.markdown;
      pageStructured = {
        markdown: extracted.markdown,
        source: "text-layer",
        columnCount: extracted.columnCount,
        blockCount: extracted.blockCount,
      };
      pageMetadata = {
        source: "text-layer",
        columnCount: extracted.columnCount,
        blockCount: extracted.blockCount,
        characterCount: anchor.characterCount,
      };
    } else {
      ({ text: pageText, structured: pageStructured, metadata: pageMetadata } = await withProviderRetry(
        () => runProviderOcr(
          deps.provider,
          deps.settings,
          deps.ocrModel,
          effectivePrompt,
          pagePreview,
          abortController.signal,
        ),
        {
          maxAttempts: effectiveMaxAttempts(deps.provider, deps.autoRetryMaxAttempts ?? 1),
          abortSignal: abortController.signal,
        },
      ));
      if (anchored.usedAnchoring) {
        pageMetadata = { ...pageMetadata, anchored: true };
      }
    }
  } finally {
    unregisterOcrJobAbortController(deps.jobId, abortController);
  }

  const durationMs = Date.now() - startedAt;
  return {
    index,
    startedAt,
    output: {
      pageNumber,
      text: pageText,
      structured: pageStructured,
      metadata: pageMetadata,
      durationMs,
    },
  };
}

function applyCompletedPage(state: OrchestratorState, deps: PageLoopDeps, run: PageRunSuccess): void {
  state.totalDurationMs += run.output.durationMs;
  state.pageOutputs.push(run.output);
  state.checkpoints.push(toPageCheckpoint(run.output));
  state.pageRecords.push(toPageRecord(run.output));
  state.partialStructuredPages.push(toStructuredPagePayload(run.output));
  state.partialPageResults.push(toPageResultPayload(run.output));

  ({ text: state.extractedTextSoFar, chunks: state.extractedChunkCount } = appendPageMarkdown(
    state.extractedTextSoFar,
    state.extractedChunkCount,
    run.output,
  ));

  const averagePageMs = state.totalDurationMs / state.pageOutputs.length;
  const remainingPages = deps.inputPreviews.length - state.pageOutputs.length;
  const etaSeconds =
    remainingPages > 0 ? Math.max(1, Math.round((averagePageMs * remainingPages) / 1000)) : 0;

  state.progressEvents = appendProgressEvent(
    state.progressEvents,
    "ocr",
    `Completed page ${run.output.pageNumber}/${deps.inputPreviews.length} in ${Math.round(run.output.durationMs / 100) / 10}s`,
  );

  state.latestMetadata = deps.snapshot({
    stage: "ocr",
    message: `Completed page ${run.output.pageNumber}/${deps.inputPreviews.length}`,
    progressPct: deps.ocrPct(),
    currentPage: run.output.pageNumber,
    etaSeconds,
  });
}

export async function runOcrPages(
  state: OrchestratorState,
  deps: PageLoopDeps,
): Promise<PageLoopResult> {
  const { inputPreviews, startIndex } = deps;
  const concurrency = Math.max(
    PAGE_CONCURRENCY_MIN,
    Math.min(PAGE_CONCURRENCY_MAX, Math.trunc(deps.pageConcurrency || 1)),
  );

  let nextIndex = startIndex;

  while (nextIndex < inputPreviews.length) {
    if (await isOcrJobStopRequested(deps.jobId)) {
      await deps.pauseAtCheckpoint(
        "Stopped. Resume to continue from checkpoint.",
        `Stopped at ${state.pageOutputs.length}/${inputPreviews.length} page(s)`,
      );
      return { paused: true };
    }

    const batchStart = nextIndex;
    const batchEnd = Math.min(nextIndex + concurrency, inputPreviews.length);
    const indices: number[] = [];
    for (let i = batchStart; i < batchEnd; i++) indices.push(i);

    const settled = await Promise.allSettled(indices.map((i) => runOnePage(state, deps, i)));

    for (let pos = 0; pos < settled.length; pos++) {
      const result = settled[pos];
      if (result.status === "fulfilled") {
        applyCompletedPage(state, deps, result.value);
        continue;
      }
      const err = result.reason;
      if (err instanceof OcrStopRequestedError || (await isOcrJobStopRequested(deps.jobId))) {
        await deps.pauseAtCheckpoint(
          "Stopped during inference. Resume to continue from checkpoint.",
          `Stopped during page ${(deps.pageNumbers?.[indices[pos]] ?? indices[pos] + 1)}/${inputPreviews.length} at ${state.pageOutputs.length}/${inputPreviews.length} page(s)`,
        );
        return { paused: true };
      }
      throw err;
    }

    await db.ocrJob.update({
      where: { id: deps.jobId },
      data: {
        extractedText: state.extractedTextSoFar,
        metadata: toJsonValue({ ...state.latestMetadata, pageRecords: state.pageRecords }),
      },
    });

    nextIndex = batchEnd;
  }

  return { paused: false };
}
