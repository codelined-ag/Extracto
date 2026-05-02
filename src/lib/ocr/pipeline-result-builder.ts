import { Prisma } from "@prisma/client";

import type { ProviderKind } from "@/lib/ocr/endpoint-policy";
import { computeTextStats } from "@/lib/ocr/pipeline-post-processing";
import type { AdvancedSettings } from "@/lib/ocr/settings";

export interface OcrJsonResult {
  fileName: string;
  extractedAt: string;
  provider: ProviderKind;
  model: string;
  settings: AdvancedSettings;
  text: string;
  markdown: string;
  structured: Record<string, unknown>;
  metadata: {
    characterCount: number;
    wordCount: number;
    lineCount: number;
    provider: ProviderKind;
    [key: string]: unknown;
  };
  rawExtractionText?: string;
  postProcessedText?: string;
}

export interface ProcessedPageOutput {
  pageNumber: number;
  text: string;
  structured: Record<string, unknown>;
  metadata: Record<string, unknown>;
  durationMs: number;
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function buildJsonResult(
  fileName: string,
  model: string,
  provider: ProviderKind,
  settings: AdvancedSettings,
  markdown: string,
  structured: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): OcrJsonResult {
  const normalizedMarkdown = markdown.trim();
  return {
    fileName,
    extractedAt: new Date().toISOString(),
    provider,
    model,
    settings,
    text: normalizedMarkdown,
    markdown: normalizedMarkdown,
    structured,
    metadata: {
      ...computeTextStats(normalizedMarkdown),
      provider,
      ...metadata,
    },
  };
}

export function toPageCheckpoint(page: ProcessedPageOutput) {
  return {
    pageNumber: page.pageNumber,
    status: "completed" as const,
    characterCount: page.text.length,
    durationMs: page.durationMs,
    previewText: page.text.trim().slice(0, 320),
  };
}

export function toPageRecord(page: ProcessedPageOutput) {
  return {
    pageNumber: page.pageNumber,
    text: page.text,
    structured: page.structured,
    durationMs: page.durationMs,
    metadata: page.metadata,
  };
}

export function toStructuredPagePayload(page: ProcessedPageOutput) {
  return {
    pageNumber: page.pageNumber,
    durationMs: page.durationMs,
    ...page.structured,
  };
}

export function toPageResultPayload(page: ProcessedPageOutput) {
  return {
    pageNumber: page.pageNumber,
    durationMs: page.durationMs,
    structured: page.structured,
    ...page.metadata,
  };
}
