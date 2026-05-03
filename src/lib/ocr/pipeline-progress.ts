import type { ProviderKind } from "@/lib/api-types";
import type { PostProcessOutputFormat } from "@/lib/ocr/settings";

export type OcrProgressStage =
  | "queued"
  | "analyzing"
  | "ocr"
  | "post_processing"
  | "exporting"
  | "finalizing"
  | "paused"
  | "completed"
  | "failed";

export interface OcrProgressEvent {
  at: string;
  stage: OcrProgressStage;
  message: string;
}

export interface OcrPageCheckpoint {
  pageNumber: number;
  status: "completed";
  characterCount: number;
  durationMs: number;
  previewText: string;
}

export interface OcrProgressMetadata {
  stage: OcrProgressStage;
  message: string;
  progressPct: number;
  pageCount: number;
  processedPages: number;
  currentPage: number | null;
  etaSeconds: number | null;
  startedAt: string;
  updatedAt: string;
  events: OcrProgressEvent[];
  checkpoints: OcrPageCheckpoint[];
  postProcessing: {
    enabled: boolean;
    applied?: boolean;
    outputFormat?: PostProcessOutputFormat;
    instruction?: string;
    model?: string;
    provider?: ProviderKind;
    error?: string;
  };
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function appendProgressEvent(
  events: OcrProgressEvent[],
  stage: OcrProgressStage,
  message: string,
): OcrProgressEvent[] {
  const nextEvents = [...events, { at: new Date().toISOString(), stage, message }];
  return nextEvents.slice(-60);
}

export function buildProgressMetadata(input: {
  stage: OcrProgressStage;
  message: string;
  progressPct: number;
  pageCount: number;
  processedPages: number;
  currentPage: number | null;
  etaSeconds: number | null;
  startedAt: string;
  events: OcrProgressEvent[];
  checkpoints: OcrPageCheckpoint[];
  postProcessing: OcrProgressMetadata["postProcessing"];
}): OcrProgressMetadata {
  return {
    stage: input.stage,
    message: input.message,
    progressPct: clampProgress(input.progressPct),
    pageCount: input.pageCount,
    processedPages: input.processedPages,
    currentPage: input.currentPage,
    etaSeconds: input.etaSeconds,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
    events: input.events,
    checkpoints: input.checkpoints,
    postProcessing: input.postProcessing,
  };
}

export const OCR_STAGE_PCT_WITH_POST_PROCESSING = 85;
export const POST_PROCESSING_KICKOFF_PCT = 90;

export function ocrStageProgressPct(
  processedPages: number,
  totalPages: number,
  hasPostProcessing: boolean,
): number {
  if (totalPages <= 0) return 0;
  return (processedPages / totalPages) * (hasPostProcessing ? OCR_STAGE_PCT_WITH_POST_PROCESSING : 100);
}

export interface ProgressSnapshotInput {
  stage: OcrProgressStage;
  message: string;
  progressPct: number;
  currentPage?: number | null;
  etaSeconds?: number | null;
}

export function createProgressSnapshotter(stable: {
  pageCount: number;
  startedAt: string;
  getProcessedPages: () => number;
  getEvents: () => OcrProgressEvent[];
  getCheckpoints: () => OcrPageCheckpoint[];
  getPostProcessing: () => OcrProgressMetadata["postProcessing"];
}): (snap: ProgressSnapshotInput) => OcrProgressMetadata {
  return (snap) =>
    buildProgressMetadata({
      stage: snap.stage,
      message: snap.message,
      progressPct: snap.progressPct,
      currentPage: snap.currentPage ?? null,
      etaSeconds: snap.etaSeconds ?? null,
      pageCount: stable.pageCount,
      processedPages: stable.getProcessedPages(),
      startedAt: stable.startedAt,
      events: stable.getEvents(),
      checkpoints: stable.getCheckpoints(),
      postProcessing: stable.getPostProcessing(),
    });
}
