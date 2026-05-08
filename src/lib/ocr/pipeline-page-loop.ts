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
import { redactPii, redactJsonValues } from "@/lib/pii/redact";
import { detectDegenerate } from "@/lib/ocr/degenerate-detection";
import { detectPageLanguage } from "@/lib/ocr/language-detection";
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
  degenerateRetryBudget: number;
}

export const computeDegenerateRetryBudget = (pageCount: number): number =>
  Math.min(10, Math.max(1, Math.ceil(pageCount / 4)));

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
  piiRedactionEnabled?: boolean;
  startIndex: number;
  snapshot: (snap: ProgressSnapshotInput) => OcrProgressMetadata;
  ocrPct: () => number;
  pauseAtCheckpoint: (stageMessage: string, eventMessage: string) => Promise<void>;
}

const PERSIST_PAGE_TEXT_CAP = 16_000;

function capPageRecordText(rec: ReturnType<typeof toPageRecord>): ReturnType<typeof toPageRecord> {
  if (rec.text.length <= PERSIST_PAGE_TEXT_CAP) return rec;
  return { ...rec, text: rec.text.slice(0, PERSIST_PAGE_TEXT_CAP) };
}

export function projectMetadataForPersistence(
  metadata: OcrProgressMetadata,
  pageRecords: ReturnType<typeof toPageRecord>[],
  redact: boolean,
): Record<string, unknown> {
  const cappedRecords = pageRecords.map(capPageRecordText);
  if (!redact) {
    return { ...metadata, pageRecords: cappedRecords };
  }
  const redactedCheckpoints = metadata.checkpoints.map((cp) => ({
    ...cp,
    previewText: redactPii(cp.previewText).redactedText,
  }));
  return {
    ...metadata,
    checkpoints: redactedCheckpoints,
    pageRecords: cappedRecords.map((rec) => redactJsonValues(rec)),
  };
}

function persistedExtractedText(text: string, redact: boolean): string {
  return redact ? redactPii(text).redactedText : text;
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
      const degenerate = detectDegenerate(pageText);
      if (degenerate && state.degenerateRetryBudget > 0 && anchored.usedAnchoring) {
        state.degenerateRetryBudget -= 1;
        try {
          const retried = await withProviderRetry(
            () =>
              runProviderOcr(
                deps.provider,
                deps.settings,
                deps.ocrModel,
                deps.prompt,
                pagePreview,
                abortController.signal,
              ),
            {
              maxAttempts: 1,
              abortSignal: abortController.signal,
            },
          );
          const retriedDegenerate = detectDegenerate(retried.text);
          if (!retriedDegenerate && retried.text.length >= pageText.length / 2) {
            pageText = retried.text;
            pageStructured = retried.structured;
            pageMetadata = {
              ...retried.metadata,
              degenerateRetry: { reason: degenerate.reason, succeeded: true },
            };
          } else {
            pageMetadata = {
              ...pageMetadata,
              degenerateRetry: {
                reason: degenerate.reason,
                succeeded: false,
                ...(retriedDegenerate ? { retriedReason: retriedDegenerate.reason } : {}),
              },
            };
          }
        } catch (err) {
          if (err instanceof OcrStopRequestedError) throw err;
          pageMetadata = {
            ...pageMetadata,
            degenerateRetry: { reason: degenerate.reason, succeeded: false },
          };
        }
      } else if (degenerate) {
        pageMetadata = {
          ...pageMetadata,
          degenerateRetry: {
            reason: degenerate.reason,
            succeeded: false,
            ...(state.degenerateRetryBudget <= 0 ? { capped: true } : {}),
            ...(!anchored.usedAnchoring ? { skipped: "no-anchoring" } : {}),
          },
        };
      }
    }
  } finally {
    unregisterOcrJobAbortController(deps.jobId, abortController);
  }

  const durationMs = Date.now() - startedAt;
  const detected = detectPageLanguage(pageText);
  if (detected) {
    pageMetadata = {
      ...pageMetadata,
      language: detected.iso6393,
      ...(detected.name ? { languageName: detected.name } : {}),
    };
  }
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

    const startPageNum = (deps.pageNumbers?.[batchStart] ?? batchStart + 1);
    const endPageNum = (deps.pageNumbers?.[batchEnd - 1] ?? batchEnd);
    const batchLabel = startPageNum === endPageNum
      ? `Running OCR on page ${startPageNum} of ${inputPreviews.length}`
      : `Running OCR on pages ${startPageNum} to ${endPageNum} of ${inputPreviews.length}`;
    state.latestMetadata = deps.snapshot({
      stage: "ocr",
      message: batchLabel,
      progressPct: deps.ocrPct(),
      currentPage: startPageNum,
      etaSeconds: state.latestMetadata.etaSeconds,
    });
    await db.ocrJob.update({
      where: { id: deps.jobId },
      data: {
        metadata: toJsonValue(
          projectMetadataForPersistence(
            state.latestMetadata,
            state.pageRecords,
            Boolean(deps.piiRedactionEnabled),
          ),
        ),
      },
    });

    const settled = await Promise.allSettled(indices.map((i) => runOnePage(state, deps, i)));

    for (let pos = 0; pos < settled.length; pos++) {
      const result = settled[pos];
      if (result.status === "fulfilled") {
        applyCompletedPage(state, deps, result.value);
        await db.ocrJob.update({
          where: { id: deps.jobId },
          data: {
            extractedText: persistedExtractedText(
              state.extractedTextSoFar,
              Boolean(deps.piiRedactionEnabled),
            ),
            metadata: toJsonValue(
              projectMetadataForPersistence(
                state.latestMetadata,
                state.pageRecords,
                Boolean(deps.piiRedactionEnabled),
              ),
            ),
          },
        });
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

    nextIndex = batchEnd;
  }

  return { paused: false };
}
