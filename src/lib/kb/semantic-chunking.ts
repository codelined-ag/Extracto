import { chunkFixed, chunkSentence, SENTENCE_BOUNDARY } from "@/lib/kb/chunking";
import { embedTexts } from "@/lib/kb/embedding";
import type { ChunkPiece, ChunkingOptions, EmbeddingProviderConfig } from "@/lib/kb/types";

export type EmbedTextsFn = typeof embedTexts;

export interface SemanticChunkingDeps {
  embedTextsFn?: EmbedTextsFn;
}

const DEFAULT_BREAKPOINT_PERCENTILE = 95;

/**
 * Semantic chunker. Splits the source into sentences, embeds all of them in
 * one batched call, then walks adjacent sentence pairs measuring cosine
 * distance. Distances above the configured percentile become chunk
 * boundaries, so the algorithm groups topically-coherent runs of sentences
 * together rather than chopping at arbitrary character offsets.
 *
 * Falls back to a degenerate single chunk if the source has fewer than two
 * sentences (no boundary to find). Honors maxChunkSize as a hard upper bound
 * by re-splitting any group that grew past it.
 */
export async function chunkSemantic(
  text: string,
  options: ChunkingOptions,
  embedding: EmbeddingProviderConfig,
  deps: SemanticChunkingDeps = {},
): Promise<ChunkPiece[]> {
  if (!text.trim()) return [];
  if (options.maxChunkSize <= 0) {
    throw new Error("maxChunkSize must be > 0");
  }

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];
  if (sentences.length === 1) {
    return enforceMaxSize([sentences[0]], options.maxChunkSize);
  }

  const percentile = clampPercentile(options.breakpointPercentile);
  const embed = deps.embedTextsFn ?? embedTexts;
  const vectors = await embed(sentences, embedding);
  if (vectors.length !== sentences.length) {
    throw new Error(
      `Semantic chunker expected ${sentences.length} embeddings, got ${vectors.length}`,
    );
  }
  const dim = vectors[0].length;
  if (dim === 0) {
    throw new Error("Semantic chunker received empty embedding vectors");
  }
  for (let i = 1; i < vectors.length; i += 1) {
    if (vectors[i].length !== dim) {
      throw new Error(
        `Semantic chunker received heterogeneous embedding dimensions (vector 0: ${dim}, vector ${i}: ${vectors[i].length})`,
      );
    }
  }

  const distances: number[] = new Array(sentences.length - 1);
  for (let i = 0; i < distances.length; i += 1) {
    distances[i] = cosineDistance(vectors[i], vectors[i + 1]);
  }

  // Strict ">" (not ">=") so percentile=100 (or any clamped overshoot) yields
  // the max distance as threshold and produces zero boundaries — a single
  // chunk falls out, which is the deliberate degenerate case.
  const threshold = percentileOf(distances, percentile);
  const groups: string[] = [];
  let current = sentences[0];
  for (let i = 1; i < sentences.length; i += 1) {
    if (distances[i - 1] > threshold) {
      groups.push(current);
      current = sentences[i];
      continue;
    }
    current = current + " " + sentences[i];
  }
  if (current) groups.push(current);

  return enforceMaxSize(groups, options.maxChunkSize);
}

function clampPercentile(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BREAKPOINT_PERCENTILE;
  return Math.max(0, Math.min(100, value));
}

function splitSentences(text: string): string[] {
  const parts = text.split(SENTENCE_BOUNDARY);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const tail = parts[i + 1] ?? "";
    const merged = (body + tail).trim();
    if (merged) out.push(merged);
  }
  return out;
}

function cosineDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return 1 - Math.max(-1, Math.min(1, sim));
}

/**
 * Linear-interpolated percentile (matches numpy's default). For a sorted
 * sample of length N, the percentile p maps to the index (N - 1) * p / 100.
 * Returns Infinity for an empty input so no boundary is ever produced.
 */
export function percentileOf(values: number[], percentile: number): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = ((sorted.length - 1) * percentile) / 100;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const frac = idx - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

function enforceMaxSize(groups: string[], maxChunkSize: number): ChunkPiece[] {
  const out: ChunkPiece[] = [];
  for (const group of groups) {
    if (group.length <= maxChunkSize) {
      out.push({ text: group });
      continue;
    }
    const sentenceSplit = chunkSentence(group, maxChunkSize, 0);
    if (sentenceSplit.length === 1 && sentenceSplit[0].length > maxChunkSize) {
      for (const piece of chunkFixed(sentenceSplit[0], maxChunkSize, 0)) {
        out.push({ text: piece });
      }
      continue;
    }
    for (const piece of sentenceSplit) {
      if (piece.length <= maxChunkSize) {
        out.push({ text: piece });
      } else {
        for (const subPiece of chunkFixed(piece, maxChunkSize, 0)) {
          out.push({ text: subPiece });
        }
      }
    }
  }
  return out;
}
