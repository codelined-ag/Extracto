import { describe, expect, it, vi } from "vitest";

import { chunkSemantic, percentileOf } from "@/lib/kb/semantic-chunking";
import type { EmbeddingProviderConfig } from "@/lib/kb/types";

const embedding: EmbeddingProviderConfig = {
  provider: "ollama",
  apiEndpoint: "http://o",
  model: "stub",
};

function unitVector(angleDeg: number): number[] {
  const rad = (angleDeg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

describe("percentileOf", () => {
  it("returns Infinity on empty input so no boundary is ever drawn", () => {
    expect(percentileOf([], 95)).toBe(Infinity);
  });

  it("returns the only value for a singleton sample", () => {
    expect(percentileOf([0.42], 50)).toBe(0.42);
  });

  it("matches numpy linear-interpolated percentile on a known sample", () => {
    expect(percentileOf([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 5);
    expect(percentileOf([1, 2, 3, 4], 100)).toBe(4);
    expect(percentileOf([1, 2, 3, 4], 0)).toBe(1);
  });
});

describe("chunkSemantic", () => {
  it("returns nothing for empty / whitespace input", async () => {
    const embedTextsFn = vi.fn();
    expect(
      await chunkSemantic("", { strategy: "semantic", maxChunkSize: 100 }, embedding, { embedTextsFn }),
    ).toEqual([]);
    expect(embedTextsFn).not.toHaveBeenCalled();
  });

  it("returns the source as a single chunk when there's only one sentence (no boundary to find)", async () => {
    const embedTextsFn = vi.fn();
    const out = await chunkSemantic(
      "Just one sentence.",
      { strategy: "semantic", maxChunkSize: 100 },
      embedding,
      { embedTextsFn },
    );
    expect(out).toEqual([{ text: "Just one sentence." }]);
    expect(embedTextsFn).not.toHaveBeenCalled();
  });

  it("splits at a topic shift detected by the percentile threshold", async () => {
    // Sentences 1-3 are 'topic A' (vectors at 0°), sentence 4 is 'topic B' (90°).
    // Distances: [0, 0, ~1] — at percentile 50 the threshold is 0, so the
    // (0->1) and (1->2) edges sit *at* the threshold (not above) and stay
    // glued; only the (2->3) edge above the threshold becomes a boundary.
    const vectors = [unitVector(0), unitVector(0), unitVector(0), unitVector(90)];
    const embedTextsFn = vi.fn().mockResolvedValue(vectors);
    const text = "Cats are mammals. Cats purr softly. Cats hunt mice. Quantum mechanics is weird.";
    const out = await chunkSemantic(
      text,
      { strategy: "semantic", maxChunkSize: 1000, breakpointPercentile: 50 },
      embedding,
      { embedTextsFn },
    );
    expect(out).toHaveLength(2);
    expect(out[0].text).toMatch(/Cats hunt mice\./);
    expect(out[1].text).toMatch(/^Quantum mechanics/);
  });

  it("uses the default percentile (95) when none is supplied", async () => {
    const vectors = [unitVector(0), unitVector(0), unitVector(0), unitVector(90)];
    const embedTextsFn = vi.fn().mockResolvedValue(vectors);
    const out = await chunkSemantic(
      "A. B. C. D.",
      { strategy: "semantic", maxChunkSize: 1000 },
      embedding,
      { embedTextsFn },
    );
    // At p=95, only the top distance survives as a boundary -> 2 chunks.
    expect(out).toHaveLength(2);
  });

  it("re-splits a semantic group that exceeds maxChunkSize via sentence/fixed fallback", async () => {
    const long = "lorem ipsum ".repeat(100); // ~1200 chars, no sentence boundary
    const vectors = [unitVector(0), unitVector(0)];
    const embedTextsFn = vi.fn().mockResolvedValue(vectors);
    const out = await chunkSemantic(
      `${long}. ${long}.`,
      { strategy: "semantic", maxChunkSize: 200, breakpointPercentile: 95 },
      embedding,
      { embedTextsFn },
    );
    for (const piece of out) {
      expect(piece.text.length).toBeLessThanOrEqual(200);
    }
  });

  it("throws when the embedder returns the wrong vector count", async () => {
    const embedTextsFn = vi.fn().mockResolvedValue([unitVector(0)]);
    await expect(
      chunkSemantic(
        "A. B.",
        { strategy: "semantic", maxChunkSize: 100 },
        embedding,
        { embedTextsFn },
      ),
    ).rejects.toThrow(/expected 2 embeddings, got 1/);
  });

  it("clamps an out-of-range breakpointPercentile into [0, 100]", async () => {
    const vectors = [unitVector(0), unitVector(90)];
    const embedTextsFn = vi.fn().mockResolvedValue(vectors);
    // p=200 should clamp to 100 -> threshold is the max distance -> nothing splits
    const out = await chunkSemantic(
      "A. B.",
      { strategy: "semantic", maxChunkSize: 1000, breakpointPercentile: 200 },
      embedding,
      { embedTextsFn },
    );
    expect(out).toHaveLength(1);
  });

  it("glues all-identical-vector sentences into a single chunk (zero distances < zero threshold)", async () => {
    const v = unitVector(0);
    const embedTextsFn = vi.fn().mockResolvedValue([v, v, v, v]);
    const out = await chunkSemantic(
      "A. B. C. D.",
      { strategy: "semantic", maxChunkSize: 1000, breakpointPercentile: 95 },
      embedding,
      { embedTextsFn },
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("A. B. C. D.");
  });

  it("throws on heterogeneous embedding dimensions across the batch", async () => {
    const embedTextsFn = vi.fn().mockResolvedValue([[1, 0, 0], [1, 0]]);
    await expect(
      chunkSemantic(
        "A. B.",
        { strategy: "semantic", maxChunkSize: 100 },
        embedding,
        { embedTextsFn },
      ),
    ).rejects.toThrow(/heterogeneous embedding dimensions/);
  });

  it("throws when the provider returns empty vectors", async () => {
    const embedTextsFn = vi.fn().mockResolvedValue([[], []]);
    await expect(
      chunkSemantic(
        "A. B.",
        { strategy: "semantic", maxChunkSize: 100 },
        embedding,
        { embedTextsFn },
      ),
    ).rejects.toThrow(/empty embedding vectors/);
  });
});
