// Pure helpers for routing OCR-output text through the right markdown shape.
// Extracted from src/app/api/ocr/route.ts so they can be unit-tested without
// touching the route's stateful pipeline.
//
// Layering:
//   parseJsonCandidate -> extractFirstBalancedJsonObject (text-extract)
//   coerceMarkdownText -> parseJsonCandidate, extractMarkdownFromJsonLikeText
//   extractStructuredPageEntryMarkdown -> coerceMarkdownText
//   getPageMarkdownForRouting -> coerceMarkdownText, extractStructuredPageEntryMarkdown
//   appendPageMarkdown -> getPageMarkdownForRouting

import {
  extractFirstBalancedJsonObject,
  extractMarkdownFromJsonLikeText,
} from "@/lib/ocr/text-extract";

/**
 * Try several JSON-parsing strategies on a string that may include code-fence
 * wrappers, leading "json" labels, or surrounding quotes. Returns the parsed
 * value or null if nothing parses.
 */
export function parseJsonCandidate(rawText: string): unknown | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

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
      return JSON.parse(candidate);
    } catch {
      // keep trying fallbacks
    }
  }

  const bracketCandidate = extractFirstBalancedJsonObject(trimmed);
  if (bracketCandidate) {
    try {
      return JSON.parse(bracketCandidate);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Coerce a maybe-string into clean markdown text. If the input parses as JSON
 * with a markdown/text/content field, that nested string is returned.
 * Otherwise, json-shaped text wrappers are stripped via
 * extractMarkdownFromJsonLikeText. As a last resort, the trimmed input is
 * returned, falling back to fallbackMarkdown when the input is empty.
 */
export function coerceMarkdownText(value: unknown, fallbackMarkdown: string): string {
  const fallback = fallbackMarkdown.trim();
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = parseJsonCandidate(trimmed);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const objectValue = parsed as Record<string, unknown>;
    const nestedValue = objectValue.markdown ?? objectValue.text ?? objectValue.content;
    if (typeof nestedValue === "string" && nestedValue.trim()) {
      return nestedValue.trim();
    }
  }

  const extractedFromPseudoJson = extractMarkdownFromJsonLikeText(trimmed);
  if (extractedFromPseudoJson) {
    return extractedFromPseudoJson;
  }

  return trimmed;
}

/**
 * Pull the markdown for a specific page from a structured.pages[] entry.
 * Matches by `index`, `pageNumber`, or `page` field, accepting either
 * 0- or 1-indexed values.
 */
export function extractStructuredPageEntryMarkdown(
  structured: Record<string, unknown>,
  pageNumber: number,
): string {
  const rawPages = Array.isArray(structured.pages) ? structured.pages : [];
  if (!rawPages.length) {
    return "";
  }

  const matching = rawPages
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const typed = entry as Record<string, unknown>;
      const indexValue = typeof typed.index === "number"
        ? Math.floor(typed.index)
        : typeof typed.pageNumber === "number"
          ? Math.floor(typed.pageNumber)
          : typeof typed.page === "number"
            ? Math.floor(typed.page)
            : null;
      if (
        indexValue !== null &&
        indexValue !== pageNumber &&
        indexValue !== pageNumber - 1
      ) {
        return "";
      }
      return coerceMarkdownText(
        typed.markdown ?? typed.text ?? typed.content ?? typed.html,
        "",
      );
    })
    .filter(Boolean);

  return matching.join("\n\n").trim();
}

/**
 * Decide which markdown to use for a given page when routing it into the
 * extracted-text accumulator. Preference order:
 *   1. structured.markdown / .text / .content / .extractedText
 *   2. structured.pages[].markdown matching this pageNumber
 *   3. page.text trimmed (raw fallback)
 */
export function getPageMarkdownForRouting(page: {
  pageNumber: number;
  text: string;
  structured: Record<string, unknown>;
}): string {
  const directMarkdown = coerceMarkdownText(
    page.structured.markdown ??
      page.structured.text ??
      page.structured.content ??
      page.structured.extractedText,
    "",
  );
  const pageEntryMarkdown = extractStructuredPageEntryMarkdown(page.structured, page.pageNumber);
  const fallback = page.text.trim();
  return coerceMarkdownText(directMarkdown || pageEntryMarkdown || fallback, fallback);
}

/**
 * Append a page's routing markdown to the running extracted text, using
 * "\n\n---\n\n" between chunks. Empty/whitespace-only pages are skipped
 * (returned state is unchanged). Pure function — caller passes in current
 * accumulators and re-binds the result.
 */
export function appendPageMarkdown(
  currentText: string,
  currentChunks: number,
  page: { pageNumber: number; text: string; structured: Record<string, unknown> },
): { text: string; chunks: number } {
  const pageMarkdown = getPageMarkdownForRouting({
    pageNumber: page.pageNumber,
    text: page.text,
    structured: page.structured,
  }).trim();
  if (!pageMarkdown) {
    return { text: currentText, chunks: currentChunks };
  }
  const separator = currentChunks > 0 ? "\n\n---\n\n" : "";
  return { text: currentText + separator + pageMarkdown, chunks: currentChunks + 1 };
}
