export type PostProcessOutputFormat = "markdown" | "json";

export interface PostProcessingSettings {
  enabled: boolean;
  instruction: string;
  outputFormat: PostProcessOutputFormat;
  model: string;
}

export interface AdvancedSettings {
  language: string;
  tableDetection: boolean;
  handwritingRecognition: boolean;
  preserveFormatting: boolean;
  customPrompt: string;
  quality: number;
  preferTextLayer: boolean;
  documentPreset: DocumentPresetKind;
  pageConcurrency: number;
  autoRetryMaxAttempts: number;
}

export const AUTO_RETRY_MIN = 1;
export const AUTO_RETRY_MAX = 8;
export const AUTO_RETRY_DEFAULT = 1;

export type DocumentPresetKind = "generic" | "academic" | "invoice" | "contract" | "form";

export const PAGE_CONCURRENCY_AUTO = 0;
export const PAGE_CONCURRENCY_MIN = 1;
export const PAGE_CONCURRENCY_MAX = 16;
export const PAGE_CONCURRENCY_DEFAULT = PAGE_CONCURRENCY_AUTO;

export const DEFAULT_SETTINGS: AdvancedSettings = {
  language: "auto",
  tableDetection: true,
  handwritingRecognition: false,
  preserveFormatting: true,
  customPrompt: "",
  quality: 80,
  preferTextLayer: true,
  documentPreset: "generic",
  pageConcurrency: PAGE_CONCURRENCY_DEFAULT,
  autoRetryMaxAttempts: AUTO_RETRY_DEFAULT,
};

const VALID_PRESETS: ReadonlySet<DocumentPresetKind> = new Set([
  "generic",
  "academic",
  "invoice",
  "contract",
  "form",
]);

function getPreset(obj: Record<string, unknown> | null, fallback: DocumentPresetKind): DocumentPresetKind {
  const v = obj?.documentPreset;
  if (typeof v === "string" && VALID_PRESETS.has(v as DocumentPresetKind)) {
    return v as DocumentPresetKind;
  }
  return fallback;
}

export const OCR_SETTINGS_KEY = "global";

function getString(obj: Record<string, unknown> | null, key: string, fallback: string): string {
  const v = obj?.[key];
  return v && typeof v === "string" ? v : fallback;
}

function getBool(obj: Record<string, unknown> | null, key: string, fallback: boolean): boolean {
  const v = obj?.[key];
  return typeof v === "boolean" ? v : fallback;
}

export function normalizeAdvancedSettings(input: unknown): AdvancedSettings {
  const c =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  const rawQuality = c?.quality;
  const quality =
    typeof rawQuality === "number" && Number.isFinite(rawQuality)
      ? Math.max(50, Math.min(100, Math.round(rawQuality / 10) * 10))
      : DEFAULT_SETTINGS.quality;

  const rawConcurrency = c?.pageConcurrency;
  let pageConcurrency = DEFAULT_SETTINGS.pageConcurrency;
  if (typeof rawConcurrency === "number" && Number.isFinite(rawConcurrency)) {
    const t = Math.trunc(rawConcurrency);
    pageConcurrency = t <= 0 ? PAGE_CONCURRENCY_AUTO : Math.min(PAGE_CONCURRENCY_MAX, Math.max(PAGE_CONCURRENCY_MIN, t));
  }

  const rawRetry = c?.autoRetryMaxAttempts;
  let autoRetryMaxAttempts = DEFAULT_SETTINGS.autoRetryMaxAttempts;
  if (typeof rawRetry === "number" && Number.isFinite(rawRetry)) {
    const t = Math.trunc(rawRetry);
    autoRetryMaxAttempts = Math.max(AUTO_RETRY_MIN, Math.min(AUTO_RETRY_MAX, t));
  }

  return {
    language: getString(c, "language", DEFAULT_SETTINGS.language),
    tableDetection: getBool(c, "tableDetection", DEFAULT_SETTINGS.tableDetection),
    handwritingRecognition: getBool(c, "handwritingRecognition", DEFAULT_SETTINGS.handwritingRecognition),
    preserveFormatting: getBool(c, "preserveFormatting", DEFAULT_SETTINGS.preserveFormatting),
    customPrompt: getString(c, "customPrompt", DEFAULT_SETTINGS.customPrompt),
    quality,
    preferTextLayer: getBool(c, "preferTextLayer", DEFAULT_SETTINGS.preferTextLayer),
    documentPreset: getPreset(c, DEFAULT_SETTINGS.documentPreset),
    pageConcurrency,
    autoRetryMaxAttempts,
  };
}

export function defaultPageConcurrencyForProvider(provider: string): number {
  switch (provider) {
    case "ollama":
      return 1;
    case "mistral":
      return 4;
    case "openrouter":
      return 4;
    case "openai_compat":
      return 2;
    default:
      return PAGE_CONCURRENCY_DEFAULT;
  }
}
