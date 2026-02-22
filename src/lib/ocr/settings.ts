export interface AdvancedSettings {
  language: string;
  tableDetection: boolean;
  handwritingRecognition: boolean;
  preserveFormatting: boolean;
  customPrompt: string;
  quality: number;
}

export const DEFAULT_SETTINGS: AdvancedSettings = {
  language: "auto",
  tableDetection: true,
  handwritingRecognition: false,
  preserveFormatting: true,
  customPrompt: "",
  quality: 80,
};

export const OCR_SETTINGS_KEY = "global";

export function normalizeAdvancedSettings(input: unknown): AdvancedSettings {
  const candidate =
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;

  const language =
    candidate?.language && typeof candidate.language === "string"
      ? candidate.language
      : DEFAULT_SETTINGS.language;

  const tableDetection =
    typeof candidate?.tableDetection === "boolean"
      ? candidate.tableDetection
      : DEFAULT_SETTINGS.tableDetection;

  const handwritingRecognition =
    typeof candidate?.handwritingRecognition === "boolean"
      ? candidate.handwritingRecognition
      : DEFAULT_SETTINGS.handwritingRecognition;

  const preserveFormatting =
    typeof candidate?.preserveFormatting === "boolean"
      ? candidate.preserveFormatting
      : DEFAULT_SETTINGS.preserveFormatting;

  const customPrompt =
    candidate?.customPrompt && typeof candidate.customPrompt === "string"
      ? candidate.customPrompt
      : DEFAULT_SETTINGS.customPrompt;

  const parsedQuality =
    typeof candidate?.quality === "number" && Number.isFinite(candidate.quality)
      ? Math.max(50, Math.min(100, Math.round(candidate.quality / 10) * 10))
      : DEFAULT_SETTINGS.quality;

  return {
    language,
    tableDetection,
    handwritingRecognition,
    preserveFormatting,
    customPrompt,
    quality: parsedQuality,
  };
}
