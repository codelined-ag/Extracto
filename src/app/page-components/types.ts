export type Translator = (
  it: string,
  en: string,
  fr?: string,
  es?: string,
  de?: string,
) => string;

export type SettingsTab = "ocr" | "kb" | "storage" | "templates" | "integrations";

export type ResultViewMode = "preview" | "split" | "result";

export type ResultFormat = "md" | "json" | "zip";

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

export type KbExportPhase = "queued" | "chunking" | "embedding" | "upserting" | "done" | "error";

export interface KbExportFileState {
  status: "idle" | "pending" | "success" | "error";
  chunkCount?: number;
  collectionName?: string;
  error?: string;
  phase?: KbExportPhase;
  embeddingDone?: number;
  embeddingTotal?: number;
}

export type S3ExportPhase = "queued" | "reading" | "uploading" | "done" | "error";

export interface S3ExportFileState {
  status: "idle" | "pending" | "success" | "error";
  phase?: S3ExportPhase;
  bucket?: string;
  keys?: string[];
  uploadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

export interface ProcessingFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "pending" | "processing" | "paused" | "completed" | "error" | "offline-queued";
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
  postProcessing?: {
    enabled: boolean;
    model?: string;
    outputFormat?: string;
    elapsedMs?: number;
    startedAt?: string;
    error?: string;
  };
  jobId?: string;
  checkpoints?: OcrPageCheckpointView[];
  events?: OcrProgressEventView[];
  file?: File;
  kbExport?: KbExportFileState;
  s3Export?: S3ExportFileState;
  isPreprocessing?: boolean;
}

export type TagColor =
  | "slate"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "purple";

export interface TagSummary {
  id: string;
  name: string;
  color: TagColor;
}

export interface TagListItem extends TagSummary {
  createdAt?: string;
  jobCount?: number;
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
  tags?: TagSummary[];
}

export interface HistoryJobDetail extends HistoryJobSummary {
  extractedText?: string | null;
  result?: unknown;
}
