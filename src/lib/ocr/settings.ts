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
}

export type DocumentPresetKind = "generic" | "academic" | "invoice" | "contract" | "form";

export const DEFAULT_SETTINGS: AdvancedSettings = {
  language: "auto",
  tableDetection: true,
  handwritingRecognition: false,
  preserveFormatting: true,
  customPrompt: "",
  quality: 80,
  preferTextLayer: true,
  documentPreset: "generic",
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

  return {
    language: getString(c, "language", DEFAULT_SETTINGS.language),
    tableDetection: getBool(c, "tableDetection", DEFAULT_SETTINGS.tableDetection),
    handwritingRecognition: getBool(c, "handwritingRecognition", DEFAULT_SETTINGS.handwritingRecognition),
    preserveFormatting: getBool(c, "preserveFormatting", DEFAULT_SETTINGS.preserveFormatting),
    customPrompt: getString(c, "customPrompt", DEFAULT_SETTINGS.customPrompt),
    quality,
    preferTextLayer: getBool(c, "preferTextLayer", DEFAULT_SETTINGS.preferTextLayer),
    documentPreset: getPreset(c, DEFAULT_SETTINGS.documentPreset),
  };
}
