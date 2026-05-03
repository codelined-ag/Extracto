export type Translator = (
  it: string,
  en: string,
  fr?: string,
  es?: string,
  de?: string,
) => string;

export type SettingsTab = "model" | "provider" | "kb" | "general" | "account";

export type ResultViewMode = "preview" | "split" | "result";

export type ResultFormat = "md" | "json";

export type UiLanguage = "it" | "en" | "fr" | "es" | "de";

export interface OcrPageCheckpointView {
  pageNumber: number;
  previewText?: string;
  characterCount?: number;
  durationMs?: number;
}

export interface OcrProgressEventView {
  at?: string;
  stage?: string;
  message?: string;
}

export interface KbExportFileState {
  status: "idle" | "pending" | "success" | "error";
  chunkCount?: number;
  collectionName?: string;
  error?: string;
}

export interface ProcessingFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "pending" | "processing" | "paused" | "completed" | "error";
  progress: number;
  result?: {
    text: string;
    json: Record<string, unknown>;
  };
  error?: string;
  preview?: string;
  pagePreviews?: string[];
  pageCount?: number;
  selectedPages?: number[];
  processedPages?: number;
  etaSeconds?: number | null;
  stage?: string;
  stageMessage?: string;
  jobId?: string;
  checkpoints?: OcrPageCheckpointView[];
  events?: OcrProgressEventView[];
  file?: File;
  kbExport?: KbExportFileState;
}

export interface HistoryJobSummary {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  fileName: string;
  sourcePreview?: string | null;
  model: string;
  createdAt: string;
  completedAt?: string | null;
  processingMs?: number | null;
  metadata?: unknown;
  errorMessage?: string | null;
}

export interface HistoryJobDetail extends HistoryJobSummary {
  extractedText?: string | null;
  result?: unknown;
}
