import { Prisma } from "@prisma/client";

import type { ProviderKind } from "@/lib/api-types";
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

export interface BuildJsonResultInput {
  fileName: string;
  model: string;
  provider: ProviderKind;
  settings: AdvancedSettings;
  markdown: string;
  structured: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export function buildJsonResult(input: BuildJsonResultInput): OcrJsonResult {
  const normalizedMarkdown = input.markdown.trim();
  return {
    fileName: input.fileName,
    extractedAt: new Date().toISOString(),
    provider: input.provider,
    model: input.model,
    settings: input.settings,
    text: normalizedMarkdown,
    markdown: normalizedMarkdown,
    structured: input.structured,
    metadata: {
      ...computeTextStats(normalizedMarkdown),
      provider: input.provider,
      ...(input.metadata ?? {}),
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
  const language = page.metadata?.language;
  const languageName = page.metadata?.languageName;
  return {
    pageNumber: page.pageNumber,
    durationMs: page.durationMs,
    ...page.structured,
    ...(typeof language === "string" ? { language } : {}),
    ...(typeof languageName === "string" ? { languageName } : {}),
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
