import type { ProviderKind } from "@/lib/ocr/endpoint-policy";
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
