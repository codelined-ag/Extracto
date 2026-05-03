import type {
  AdvancedSettings,
  PostProcessingSettings,
} from "@/lib/ocr/settings";
import { applyDocumentPresetToPrompt, getDocumentPreset } from "@/lib/ocr/document-presets";

const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;
const MAX_STORED_PREVIEW_LENGTH = 1_500_000;

export function sanitizePostProcessing(
  raw: Partial<PostProcessingSettings> | undefined,
): PostProcessingSettings {
  const rawInstruction = typeof raw?.instruction === "string" ? raw.instruction.trim() : "";
  const outputFormat = raw?.outputFormat === "json" ? "json" : "markdown";
  const model = typeof raw?.model === "string" ? raw.model.trim() : "";
  const enabled = Boolean(raw?.enabled) && rawInstruction.length > 0;
  return {
    enabled,
    instruction: rawInstruction.slice(0, MAX_POST_PROCESS_INSTRUCTION_LENGTH),
    outputFormat,
    model,
  };
}

export function normalizePreviewForHistory(preview: string): string | null {
  const trimmed = preview.trim();
  if (!trimmed.startsWith("data:image/")) return null;
  if (trimmed.length > MAX_STORED_PREVIEW_LENGTH) return null;
  return trimmed;
}

export function buildPrompt(settings: AdvancedSettings): string {
  const preset = getDocumentPreset(settings.documentPreset);
  const effectiveTableDetection = preset.forceTableDetection ?? settings.tableDetection;
  const effectivePreserveFormatting = preset.forcePreserveFormatting ?? settings.preserveFormatting;
  const languageInstruction =
    settings.language !== "auto"
      ? `The document is in ${settings.language}. Please transcribe in that language.`
      : "Detect the document language automatically.";
  const tableInstruction = effectiveTableDetection
    ? "If there are tables, format them using markdown tables with proper column alignment."
    : "Extract table content as plain text.";
  const handwritingInstruction = settings.handwritingRecognition
    ? "Pay special attention to handwritten text and do your best to transcribe it accurately."
    : "Focus on printed text only.";
  const formattingInstruction = effectivePreserveFormatting
    ? "Preserve the original formatting, layout, and structure as much as possible including spacing, indentation, and alignment."
    : "Extract text in a simplified format, focusing on content over formatting.";

  const base = `You are an OCR (Optical Character Recognition) system. Extract all text from this document image.

Instructions:
1. Extract ALL text visible in the image
2. ${languageInstruction}
3. ${tableInstruction}
4. ${handwritingInstruction}
5. ${formattingInstruction}
6. Include any numbers, dates, and special characters exactly as shown
7. If text is unclear or illegible, indicate with [illegible]

Quality focus: ${settings.quality}%

Return ONLY valid JSON with this exact shape:
{
  "markdown": "clean markdown text extracted from the image",
  "fields": {}
}

Rules:
- "markdown" is required and must contain the extracted OCR content.
- "fields" is optional but if present must be a JSON object.
- Do not wrap JSON in markdown code fences.`;
  const presetPrompt = applyDocumentPresetToPrompt(base, settings.documentPreset);
  if (!settings.customPrompt.trim()) return presetPrompt;
  return `${presetPrompt}\n\nUSER OVERRIDE (highest priority, applies last):\n${settings.customPrompt}`;
}
