// Pure text-chunking strategies for KB export.
//
// Each chunkXxx() takes a source string and ChunkingOptions, returns an
// array of plain strings. The caller wraps these with metadata to form
// final Chunk[] records.
//
// All strategies share an absolute upper bound (maxChunkSize). Strategy-
// specific behavior:
//   fixed    — hard-split every maxChunkSize chars with optional overlap
//   sentence — split on sentence-ending punctuation, merge until size
//   paragraph— split on blank lines, merge until size
//
// No regex catastrophic-backtracking risk: all patterns are linear.

import type { ChunkingOptions, ChunkingStrategy } from "@/lib/kb/types";

export function chunk(text: string, options: ChunkingOptions): string[] {
  if (!text) return [];
  if (options.maxChunkSize <= 0) {
    throw new Error("maxChunkSize must be > 0");
  }
  switch (options.strategy) {
    case "fixed":
      return chunkFixed(text, options.maxChunkSize, options.overlap ?? 0);
    case "sentence":
      return chunkSentence(text, options.maxChunkSize, options.minChunkSize ?? 0);
    case "paragraph":
      return chunkParagraph(text, options.maxChunkSize, options.minChunkSize ?? 0);
    default: {
      const _exhaustive: never = options.strategy;
      throw new Error(`Unknown chunking strategy: ${_exhaustive as string}`);
    }
  }
}

export function chunkFixed(text: string, maxChunkSize: number, overlap: number): string[] {
  if (overlap < 0) {
    throw new Error("overlap must be >= 0");
  }
  if (overlap >= maxChunkSize) {
    throw new Error("overlap must be < maxChunkSize");
  }
  const stride = maxChunkSize - overlap;
  const chunks: string[] = [];
  let lastEnd = 0;
  for (let i = 0; i < text.length; i += stride) {
    const end = Math.min(i + maxChunkSize, text.length);
    // Skip an iteration that would produce a chunk fully contained in the
    // previous one — this happens at the tail when (text.length - maxChunkSize)
    // is not divisible by stride.
    if (end <= lastEnd) break;
    chunks.push(text.slice(i, end));
    lastEnd = end;
    if (end >= text.length) break;
  }
  return chunks;
}

const SENTENCE_BOUNDARY = /([.!?]+["')\]]*\s+)/u;

export function chunkSentence(text: string, maxChunkSize: number, minChunkSize: number): string[] {
  // Split on sentence-ending punctuation while keeping the punctuation with
  // the preceding sentence. The trailing element is the unmatched tail.
  const parts = text.split(SENTENCE_BOUNDARY);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const tail = parts[i + 1] ?? "";
    const merged = (body + tail).trim();
    if (merged) sentences.push(merged);
  }
  return mergeUntilSize(sentences, " ", maxChunkSize, minChunkSize);
}

export function chunkParagraph(text: string, maxChunkSize: number, minChunkSize: number): string[] {
  const paragraphs = text
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .filter(Boolean);
  return mergeUntilSize(paragraphs, "\n\n", maxChunkSize, minChunkSize);
}

/**
 * Merge an array of pre-split units (sentences, paragraphs) into chunks no
 * larger than maxChunkSize. Units larger than maxChunkSize are hard-split
 * via chunkFixed with no overlap. minChunkSize coalesces tiny trailing
 * chunks into the previous one when possible.
 */
function mergeUntilSize(
  units: string[],
  joiner: string,
  maxChunkSize: number,
  minChunkSize: number,
): string[] {
  const out: string[] = [];
  let current = "";
  for (const unit of units) {
    if (unit.length > maxChunkSize) {
      // flush current first
      if (current) {
        out.push(current);
        current = "";
      }
      for (const piece of chunkFixed(unit, maxChunkSize, 0)) {
        out.push(piece);
      }
      continue;
    }
    if (!current) {
      current = unit;
      continue;
    }
    const candidate = current + joiner + unit;
    if (candidate.length <= maxChunkSize) {
      current = candidate;
    } else {
      out.push(current);
      current = unit;
    }
  }
  if (current) out.push(current);

  if (minChunkSize > 0 && out.length > 1) {
    return mergeTinyTrailing(out, joiner, minChunkSize, maxChunkSize);
  }
  return out;
}

function mergeTinyTrailing(
  chunks: string[],
  joiner: string,
  minChunkSize: number,
  maxChunkSize: number,
): string[] {
  const out: string[] = [];
  for (const piece of chunks) {
    const last = out[out.length - 1];
    if (last && piece.length < minChunkSize && (last + joiner + piece).length <= maxChunkSize) {
      out[out.length - 1] = last + joiner + piece;
    } else {
      out.push(piece);
    }
  }
  return out;
}

export const SUPPORTED_STRATEGIES: readonly ChunkingStrategy[] = [
  "fixed",
  "sentence",
  "paragraph",
] as const;
