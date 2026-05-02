// Pure utilities lifted out of src/app/page.tsx (which still owns the
// huge ExtractoPage component). These are formatters + JSON-parsing
// helpers with no React state, so they're easier to read in isolation
// and become unit-testable.

import {
  extractFirstBalancedJsonObject,
  extractMarkdownFromJsonLikeText,
} from "@/lib/ocr/text-extract";

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const formatTimestamp = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const formatEta = (value?: number | null): string => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }
  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export function parseLooseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const directCandidates = [
    trimmed,
    trimmed.replace(/^json\s*/iu, "").trim(),
    trimmed.replace(/^['"]+|['"]+$/g, "").trim(),
  ];

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fencedMatch?.[1]) {
    directCandidates.unshift(fencedMatch[1].trim());
  }

  for (const candidate of directCandidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue
    }
  }

  const balanced = extractFirstBalancedJsonObject(trimmed);
  if (balanced) {
    try {
      const parsed = JSON.parse(balanced);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function normalizeMarkdownCandidate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parsed = parseLooseJsonObject(trimmed);
  if (parsed) {
    const nested = parsed.markdown ?? parsed.text ?? parsed.content;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }

  const extracted = extractMarkdownFromJsonLikeText(trimmed);
  if (extracted) {
    return extracted;
  }

  return trimmed;
}

export function getMarkdownFromJsonPayload(payload: unknown, fallback = ""): string {
  const fallbackNormalized = normalizeMarkdownCandidate(fallback);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallbackNormalized;
  }

  const typed = payload as Record<string, unknown>;
  if (typeof typed.markdown === "string" && typed.markdown.trim()) {
    return normalizeMarkdownCandidate(typed.markdown);
  }

  if (
    typed.structured &&
    typeof typed.structured === "object" &&
    !Array.isArray(typed.structured) &&
    typeof (typed.structured as Record<string, unknown>).markdown === "string" &&
    ((typed.structured as Record<string, unknown>).markdown as string).trim()
  ) {
    return normalizeMarkdownCandidate((typed.structured as Record<string, unknown>).markdown as string);
  }

  if (typeof typed.text === "string" && typed.text.trim()) {
    return normalizeMarkdownCandidate(typed.text);
  }

  return fallbackNormalized;
}

export function getStructuredJsonPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const typed = payload as Record<string, unknown>;
  if (typed.structured && typeof typed.structured === "object" && !Array.isArray(typed.structured)) {
    return typed.structured as Record<string, unknown>;
  }

  return typed;
}
