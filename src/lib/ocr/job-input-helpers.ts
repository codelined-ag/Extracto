import type {
  AdvancedSettings,
  PostProcessingSettings,
} from "@/lib/ocr/settings";
import { ApiRouteError } from "@/lib/api-error";
import { applyDocumentPresetToPrompt, getDocumentPreset } from "@/lib/ocr/document-presets";
import {
  MAX_OCR_JOB_IMAGE_CHARS,
  MAX_OCR_PAGE_IMAGE_CHARS,
  MAX_OCR_SUBMIT_PAGES,
  MAX_SOURCE_PDF_BYTES,
} from "@/lib/ocr/input-limits";
import {
  DEFAULT_POST_PROCESS_TEMPLATE,
  isPostProcessTemplate,
  resolveTemplateInstruction,
  sanitizeTargetLanguage,
} from "@/lib/ocr/post-processing-templates";

const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;
const MAX_STORED_PREVIEW_LENGTH = 1_500_000;
const MAX_OCR_PAGE_NUMBER = 10_000;
const PDF_DATA_URL_PREFIX = /^data:application\/(?:x-)?pdf(?:[;,]|$)/u;

export function sanitizePostProcessing(
  raw: Partial<PostProcessingSettings> | undefined,
): PostProcessingSettings {
  const rawInstruction = typeof raw?.instruction === "string" ? raw.instruction.trim() : "";
  const outputFormat = raw?.outputFormat === "json" ? "json" : "markdown";
  const model = typeof raw?.model === "string" ? raw.model.trim() : "";
  const template = isPostProcessTemplate(raw?.template) ? raw.template : DEFAULT_POST_PROCESS_TEMPLATE;
  const targetLanguage = sanitizeTargetLanguage(raw?.targetLanguage);
  const customInstruction = rawInstruction.slice(0, MAX_POST_PROCESS_INSTRUCTION_LENGTH);
  const resolved = resolveTemplateInstruction({
    template,
    targetLanguage,
    customInstruction,
  });
  const enabled = Boolean(raw?.enabled) && resolved.length > 0;
  return {
    enabled,
    instruction: resolved,
    outputFormat,
    model,
    template,
    targetLanguage,
  };
}

export function normalizePreviewForHistory(preview: string): string | null {
  const trimmed = preview.trim();
  if (!trimmed.startsWith("data:image/")) return null;
  if (trimmed.length > MAX_STORED_PREVIEW_LENGTH) return null;
  return trimmed;
}

export function normalizeOcrInputPreviews(
  rawPages: unknown,
  rawPreview: unknown,
  maxPages = MAX_OCR_SUBMIT_PAGES,
): string[] {
  const preview = typeof rawPreview === "string" ? rawPreview.trim() : "";
  if (preview.length > MAX_OCR_PAGE_IMAGE_CHARS) {
    throw new ApiRouteError("preview is too large", 413);
  }
  if (!Array.isArray(rawPages)) {
    return preview ? [preview] : [];
  }

  if (rawPages.length > maxPages) {
    throw new ApiRouteError(`At most ${maxPages} page images can be submitted per OCR job`, 400);
  }

  let totalChars = 0;
  const pages = rawPages.map((page, index) => {
    if (typeof page !== "string") {
      throw new ApiRouteError(`pages[${index}] must be a string`, 400);
    }
    const trimmed = page.trim();
    if (trimmed.length > MAX_OCR_PAGE_IMAGE_CHARS) {
      throw new ApiRouteError(`pages[${index}] is too large`, 413);
    }
    totalChars += trimmed.length;
    if (totalChars > MAX_OCR_JOB_IMAGE_CHARS) {
      throw new ApiRouteError("OCR page images are too large for one job", 413);
    }
    return trimmed;
  }).filter(Boolean);

  if (pages.length > maxPages) {
    throw new ApiRouteError(`At most ${maxPages} page images can be submitted per OCR job`, 400);
  }

  return pages.length > 0 ? pages : preview ? [preview] : [];
}

export function normalizeOcrPageNumbers(
  rawPageNumbers: unknown,
  expectedLength: number,
): number[] | undefined {
  if (rawPageNumbers === undefined || rawPageNumbers === null) return undefined;
  if (!Array.isArray(rawPageNumbers)) {
    throw new ApiRouteError("pageNumbers must be an array of positive integers (1-indexed)", 400);
  }

  const cleaned = rawPageNumbers.filter(
    (p): p is number =>
      typeof p === "number" &&
      Number.isInteger(p) &&
      p >= 1 &&
      p <= MAX_OCR_PAGE_NUMBER,
  );
  if (cleaned.length !== rawPageNumbers.length) {
    throw new ApiRouteError("pageNumbers must be a list of positive integers (1-indexed)", 400);
  }
  if (cleaned.length !== expectedLength) {
    throw new ApiRouteError(
      `pageNumbers length (${cleaned.length}) must equal inputPreviews length (${expectedLength})`,
      400,
    );
  }
  if (new Set(cleaned).size !== cleaned.length) {
    throw new ApiRouteError("pageNumbers must not contain duplicates", 400);
  }
  for (let i = 1; i < cleaned.length; i++) {
    if (cleaned[i] <= cleaned[i - 1]) {
      throw new ApiRouteError("pageNumbers must be strictly ascending", 400);
    }
  }
  return cleaned;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Number.POSITIVE_INFINITY;
  const metadata = dataUrl.slice(0, comma).toLowerCase();
  const payload = dataUrl.slice(comma + 1).replace(/\s+/gu, "");
  if (!metadata.includes(";base64")) return payload.length;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function normalizeSourcePdfForAnchoring(
  rawSourcePdf: unknown,
  pageNumbers: number[] | undefined,
  expectedLength: number,
): string | undefined {
  const sourcePdf = typeof rawSourcePdf === "string" ? rawSourcePdf.trim() : "";
  if (!sourcePdf) return undefined;
  if (!PDF_DATA_URL_PREFIX.test(sourcePdf)) return undefined;
  if (!pageNumbers || pageNumbers.length !== expectedLength) return undefined;
  if (estimateDataUrlBytes(sourcePdf) > MAX_SOURCE_PDF_BYTES) return undefined;
  return sourcePdf;
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
- "markdown" is required and must contain the extracted OCR content as proper Markdown.
- Use # for the document title, ## for major section headings, ### for sub-sections. Do not invent headings that aren't visually distinct in the source.
- Use blank lines between paragraphs. Use - or * for bullet lists, 1. for numbered lists.
- Use **bold** and *italic* only when they're clearly emphasized in the source.
- Use markdown tables for tabular content with proper column alignment.
- "fields" is optional but if present must be a JSON object.
- Do not wrap JSON in markdown code fences.`;
  const presetPrompt = applyDocumentPresetToPrompt(base, settings.documentPreset);
  if (!settings.customPrompt.trim()) return presetPrompt;
  return `${presetPrompt}\n\nUSER OVERRIDE (highest priority, applies last):\n${settings.customPrompt}`;
}
