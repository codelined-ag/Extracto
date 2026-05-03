import type { ChunkPiece, ChunkingOptions, ChunkingStrategy } from "@/lib/kb/types";

export function chunk(text: string, options: ChunkingOptions): ChunkPiece[] {
  if (!text) return [];
  if (options.maxChunkSize <= 0) {
    throw new Error("maxChunkSize must be > 0");
  }
  switch (options.strategy) {
    case "fixed":
      return wrapPlain(chunkFixed(text, options.maxChunkSize, options.overlap ?? 0));
    case "sentence":
      return wrapPlain(chunkSentence(text, options.maxChunkSize, options.minChunkSize ?? 0));
    case "paragraph":
      return wrapPlain(chunkParagraph(text, options.maxChunkSize, options.minChunkSize ?? 0));
    case "hierarchical":
      return chunkHierarchical(
        text,
        options.maxChunkSize,
        options.minChunkSize ?? 0,
        clampHeadingDepth(options.maxHeadingDepth),
      );
    case "semantic":
      throw new Error(
        'chunk() does not support strategy "semantic": use chunkSemantic() from semantic-chunking.ts',
      );
    default: {
      const _exhaustive: never = options.strategy;
      throw new Error(`Unknown chunking strategy: ${_exhaustive as string}`);
    }
  }
}

function wrapPlain(strings: string[]): ChunkPiece[] {
  return strings.map((text) => ({ text }));
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
    if (end <= lastEnd) break;
    chunks.push(text.slice(i, end));
    lastEnd = end;
    if (end >= text.length) break;
  }
  return chunks;
}

export const SENTENCE_BOUNDARY = /([.!?]+["')\]]*\s+)/u;

export function chunkSentence(text: string, maxChunkSize: number, minChunkSize: number): string[] {
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

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/u;

interface HeadingSection {
  level: number;
  path: string[];
  body: string;
}

function clampHeadingDepth(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(6, Math.trunc(value)));
}

/**
 * Walk the document line-by-line and collect (heading-path, body) sections.
 * Headings deeper than maxDepth are folded into the deepest in-bounds parent
 * (their text becomes a body line under that parent rather than a new node).
 * Lines preceding the first heading form an implicit "preface" section with
 * an empty path and level 0.
 */
function splitByHeadings(text: string, maxDepth: number): HeadingSection[] {
  const lines = text.split(/\r?\n/u);
  const stack: { level: number; title: string }[] = [];
  const sections: HeadingSection[] = [];
  let currentBody: string[] = [];

  const flush = (level: number) => {
    if (currentBody.length === 0 && stack.length === 0 && sections.length === 0) {
      return;
    }
    const body = currentBody.join("\n").trim();
    sections.push({
      level,
      path: stack.map((s) => s.title),
      body,
    });
    currentBody = [];
  };

  let pendingLevel = 0;
  for (const line of lines) {
    const m = ATX_HEADING.exec(line);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();
      if (level > maxDepth) {
        currentBody.push(line);
        continue;
      }
      flush(pendingLevel);
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, title });
      pendingLevel = level;
      continue;
    }
    currentBody.push(line);
  }
  flush(pendingLevel);

  return sections.filter((s) => s.body.length > 0);
}

/**
 * Hierarchical chunker. For every leaf section in the heading tree, splits
 * its body into paragraphs (then sentences if a paragraph is still too
 * large), packs them up to maxChunkSize, and tags each emitted chunk with
 * the heading breadcrumb. Sections without headings get an empty path and
 * level 0. Honors minChunkSize for tail-merging within a section, but
 * never merges across heading boundaries — that would defeat the purpose.
 */
export function chunkHierarchical(
  text: string,
  maxChunkSize: number,
  minChunkSize: number,
  maxHeadingDepth: number,
): ChunkPiece[] {
  const sections = splitByHeadings(text, maxHeadingDepth);
  const out: ChunkPiece[] = [];
  for (const section of sections) {
    const paragraphs = section.body
      .split(/\n\s*\n/u)
      .map((p) => p.trim())
      .filter(Boolean);
    const expanded: string[] = [];
    for (const p of paragraphs) {
      if (p.length <= maxChunkSize) {
        expanded.push(p);
        continue;
      }
      const sentences = chunkSentence(p, maxChunkSize, 0);
      for (const s of sentences) expanded.push(s);
    }
    const merged = mergeUntilSize(expanded, "\n\n", maxChunkSize, minChunkSize);
    for (const piece of merged) {
      out.push({
        text: piece,
        extras: {
          headingPath: section.path,
          headingLevel: section.level,
        },
      });
    }
  }
  return out;
}

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
  "hierarchical",
  "semantic",
] as const;
