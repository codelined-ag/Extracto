import { describe, expect, it } from "vitest";

import { diffWords, summarizeDiff, tokenize } from "@/lib/diff/word-diff";

describe("tokenize", () => {
  it("splits on whitespace boundaries while keeping the spacing tokens", () => {
    expect(tokenize("hello  world")).toEqual(["hello  ", "world"]);
    expect(tokenize("a\nb c")).toEqual(["a\n", "b ", "c"]);
  });

  it("handles empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("diffWords", () => {
  it("returns one equal run when the two texts match", () => {
    const segments = diffWords("hello world", "hello world");
    expect(segments).toEqual([{ op: "equal", text: "hello world" }]);
  });

  it("flags an inserted word", () => {
    const segments = diffWords("hello world", "hello brave world");
    expect(segments.some((s) => s.op === "insert" && /brave/.test(s.text))).toBe(true);
  });

  it("flags a deleted word", () => {
    const segments = diffWords("hello brave world", "hello world");
    expect(segments.some((s) => s.op === "delete" && /brave/.test(s.text))).toBe(true);
  });

  it("merges adjacent runs of the same op", () => {
    const segments = diffWords("a b c", "a x y c");
    const ops = segments.map((s) => s.op).join(",");
    expect(ops).not.toContain("insert,insert");
    expect(ops).not.toContain("delete,delete");
  });

  it("reproduces the second text by concatenating equal+insert segments", () => {
    const a = "The quick brown fox jumps over the lazy dog";
    const b = "The quick red fox leaps over the lazy hippopotamus";
    const segments = diffWords(a, b);
    const reconstructedB = segments
      .filter((s) => s.op === "equal" || s.op === "insert")
      .map((s) => s.text)
      .join("");
    expect(reconstructedB).toBe(b);
  });

  it("reproduces the first text by concatenating equal+delete segments", () => {
    const a = "Vendor: ACME\nTotal: 32.48";
    const b = "Vendor: ACME Corp\nTotal: $32.48";
    const segments = diffWords(a, b);
    const reconstructedA = segments
      .filter((s) => s.op === "equal" || s.op === "delete")
      .map((s) => s.text)
      .join("");
    expect(reconstructedA).toBe(a);
  });
});

describe("summarizeDiff", () => {
  it("counts equal/inserted/deleted chars and computes similarity", () => {
    const segments = diffWords("hello world", "hello brave world");
    const summary = summarizeDiff(segments);
    expect(summary.equalChars).toBeGreaterThan(0);
    expect(summary.insertedChars).toBeGreaterThan(0);
    expect(summary.deletedChars).toBe(0);
    expect(summary.similarity).toBeGreaterThan(0);
    expect(summary.similarity).toBeLessThan(1);
  });

  it("returns similarity 1 when the texts match exactly", () => {
    const segments = diffWords("identical text", "identical text");
    expect(summarizeDiff(segments).similarity).toBe(1);
  });

  it("handles empty input gracefully", () => {
    expect(summarizeDiff([])).toEqual({ equalChars: 0, insertedChars: 0, deletedChars: 0, similarity: 1 });
  });
});
