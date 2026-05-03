import { describe, it, expect } from "vitest";
import { chunk, chunkFixed, chunkParagraph, chunkSentence, SUPPORTED_STRATEGIES } from "@/lib/kb/chunking";

describe("chunkFixed", () => {
  it("returns empty array for empty input", () => {
    expect(chunkFixed("", 10, 0)).toEqual([]);
  });

  it("returns one chunk when text fits", () => {
    expect(chunkFixed("hello", 10, 0)).toEqual(["hello"]);
  });

  it("splits into equal-sized pieces with no overlap", () => {
    expect(chunkFixed("abcdefghij", 4, 0)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("applies overlap between consecutive chunks", () => {
    expect(chunkFixed("abcdefgh", 4, 2)).toEqual(["abcd", "cdef", "efgh"]);
  });

  it("throws on negative overlap", () => {
    expect(() => chunkFixed("abc", 4, -1)).toThrow("overlap must be >= 0");
  });

  it("throws when overlap equals chunk size", () => {
    expect(() => chunkFixed("abc", 4, 4)).toThrow("overlap must be < maxChunkSize");
  });

  it("throws when overlap exceeds chunk size", () => {
    expect(() => chunkFixed("abc", 4, 10)).toThrow("overlap must be < maxChunkSize");
  });

  it("does not lose characters with overlap", () => {
    const text = "0123456789";
    const chunks = chunkFixed(text, 4, 1);
    // each chunk shares 1 char with the next; reconstructing dedup'd is nontrivial,
    // but every original char must appear in at least one chunk
    for (let i = 0; i < text.length; i++) {
      expect(chunks.some((c) => c.includes(text[i]))).toBe(true);
    }
  });

  it("handles a single chunk that fills exactly maxChunkSize", () => {
    expect(chunkFixed("abcd", 4, 0)).toEqual(["abcd"]);
  });

  it("does NOT emit a duplicate-suffix tail chunk when (len - max) is not divisible by stride", () => {
    // text length 10, max 4, overlap 1, stride 3:
    //   i=0 -> "0123" (end=4)
    //   i=3 -> "3456" (end=7)
    //   i=6 -> "6789" (end=10)
    //   i=9 -> end=10 (== lastEnd) -> SKIP (was emitting "9" as a duplicate)
    const result = chunkFixed("0123456789", 4, 1);
    expect(result).toEqual(["0123", "3456", "6789"]);
  });

  it("does not emit a chunk fully contained in the previous one (overlap=2, length-tail edge)", () => {
    // text length 10, max 4, overlap 2, stride 2:
    //   i=0 -> "0123" (end=4)
    //   i=2 -> "2345"; i=4 -> "4567"; i=6 -> "6789" (end=10) — STOP
    expect(chunkFixed("0123456789", 4, 2)).toEqual(["0123", "2345", "4567", "6789"]);
  });
});

describe("chunkSentence", () => {
  it("returns empty array for empty input", () => {
    expect(chunkSentence("", 100, 0)).toEqual([]);
  });

  it("keeps a single small sentence as one chunk", () => {
    expect(chunkSentence("Hello world.", 100, 0)).toEqual(["Hello world."]);
  });

  it("splits on sentence boundaries", () => {
    const text = "First sentence. Second sentence! Third one?";
    const chunks = chunkSentence(text, 17, 0);
    expect(chunks).toEqual(["First sentence.", "Second sentence!", "Third one?"]);
  });

  it("merges multiple short sentences up to maxChunkSize", () => {
    const text = "One. Two. Three. Four.";
    const chunks = chunkSentence(text, 100, 0);
    expect(chunks).toEqual(["One. Two. Three. Four."]);
  });

  it("hard-splits a single oversized sentence", () => {
    const longSentence = "x".repeat(120) + ".";
    const chunks = chunkSentence(longSentence, 50, 0);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(50));
  });

  it("preserves question marks and exclamation points with the sentence", () => {
    const chunks = chunkSentence("Why? Because!", 50, 0);
    expect(chunks[0]).toMatch(/Why\?/);
    expect(chunks[0]).toMatch(/Because!/);
  });

  it("handles trailing punctuation followed by quotes", () => {
    const text = 'He said "hello". She said "world".';
    const chunks = chunkSentence(text, 30, 0);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(30));
  });

  it("respects minChunkSize by merging tiny trailing chunks", () => {
    const text = "A long enough sentence here. Tiny.";
    const chunks = chunkSentence(text, 100, 10);
    // "Tiny." (5 chars) is below minChunkSize=10 so it merges with the prior
    expect(chunks).toEqual(["A long enough sentence here. Tiny."]);
  });
});

describe("chunkParagraph", () => {
  it("returns empty array for empty input", () => {
    expect(chunkParagraph("", 100, 0)).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(chunkParagraph("   \n\n   ", 100, 0)).toEqual([]);
  });

  it("splits on blank lines", () => {
    const text = "Para one.\n\nPara two.\n\nPara three.";
    const chunks = chunkParagraph(text, 12, 0);
    expect(chunks).toEqual(["Para one.", "Para two.", "Para three."]);
  });

  it("merges paragraphs with double-newline joiner", () => {
    const text = "A.\n\nB.";
    const chunks = chunkParagraph(text, 100, 0);
    expect(chunks).toEqual(["A.\n\nB."]);
  });

  it("handles a single oversized paragraph by hard-splitting it", () => {
    const para = "y".repeat(200);
    const chunks = chunkParagraph(para, 50, 0);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(50));
  });

  it("treats varying blank-line whitespace as a single boundary (size forces split)", () => {
    // maxChunkSize=2 prevents the merger from re-joining "A" and "B" into "A\n\nB"
    expect(chunkParagraph("A\n   \nB", 2, 0)).toEqual(["A", "B"]);
  });
});

describe("chunk (dispatcher)", () => {
  it("returns empty array for empty input regardless of strategy", () => {
    for (const strategy of SUPPORTED_STRATEGIES) {
      expect(chunk("", { strategy, maxChunkSize: 100 })).toEqual([]);
    }
  });

  it("dispatches to chunkFixed when strategy=fixed", () => {
    const result = chunk("abcdefghij", { strategy: "fixed", maxChunkSize: 4, overlap: 0 });
    expect(result.map((p) => p.text)).toEqual(["abcd", "efgh", "ij"]);
    expect(result.every((p) => p.extras === undefined)).toBe(true);
  });

  it("dispatches to chunkSentence when strategy=sentence", () => {
    const result = chunk("One. Two.", { strategy: "sentence", maxChunkSize: 5 });
    expect(result.length).toBeGreaterThan(1);
  });

  it("dispatches to chunkParagraph when strategy=paragraph", () => {
    const result = chunk("A\n\nB", { strategy: "paragraph", maxChunkSize: 2 });
    expect(result.map((p) => p.text)).toEqual(["A", "B"]);
  });

  it("throws on maxChunkSize=0", () => {
    expect(() => chunk("abc", { strategy: "fixed", maxChunkSize: 0 })).toThrow();
  });

  it("throws on negative maxChunkSize", () => {
    expect(() => chunk("abc", { strategy: "fixed", maxChunkSize: -1 })).toThrow();
  });

  it("uses defaults when overlap/minChunkSize are omitted", () => {
    expect(chunk("abcdefgh", { strategy: "fixed", maxChunkSize: 4 }).map((p) => p.text)).toEqual([
      "abcd",
      "efgh",
    ]);
    expect(chunk("Hello.", { strategy: "sentence", maxChunkSize: 100 }).map((p) => p.text)).toEqual(
      ["Hello."],
    );
  });

  it("refuses semantic via the sync chunk() entrypoint", () => {
    expect(() => chunk("abc", { strategy: "semantic", maxChunkSize: 100 })).toThrow(/semantic/i);
  });
});

describe("SUPPORTED_STRATEGIES", () => {
  it("lists every strategy the dispatcher accepts", () => {
    expect([...SUPPORTED_STRATEGIES]).toEqual([
      "fixed",
      "sentence",
      "paragraph",
      "hierarchical",
      "semantic",
    ]);
  });
});
