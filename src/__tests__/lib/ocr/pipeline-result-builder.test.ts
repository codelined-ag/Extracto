import { describe, it, expect } from "vitest";
import {
  buildJsonResult,
  toJsonValue,
  toPageCheckpoint,
  toPageRecord,
  toPageResultPayload,
  toStructuredPagePayload,
} from "@/lib/ocr/pipeline-result-builder";
import type { ProcessedPageOutput } from "@/lib/ocr/pipeline-result-builder";

const settings = {
  language: "auto",
  tableDetection: true,
  handwritingRecognition: false,
  preserveFormatting: true,
  customPrompt: "",
  quality: 80,
} as const;

const page: ProcessedPageOutput = {
  pageNumber: 3,
  text: "  some text\nmore  ",
  structured: { markdown: "x" },
  metadata: { foo: "bar" },
  durationMs: 1234,
};

describe("toJsonValue", () => {
  it("round-trips the input through JSON to drop functions / undefined", () => {
    expect(toJsonValue({ a: 1, b: { c: [2, 3] } })).toEqual({ a: 1, b: { c: [2, 3] } });
  });

  it("returns a structurally cloned value (mutating the source does not affect output)", () => {
    const src = { a: { b: 1 } };
    const out = toJsonValue(src) as { a: { b: number } };
    src.a.b = 99;
    expect(out.a.b).toBe(1);
  });
});

describe("buildJsonResult", () => {
  it("trims markdown and computes text stats inside metadata", () => {
    const r = buildJsonResult("doc.pdf", "qwen", "ollama", settings, "  hello world  ", { extra: 1 }, { other: 2 });
    expect(r.markdown).toBe("hello world");
    expect(r.text).toBe("hello world");
    expect(r.metadata.characterCount).toBe(11);
    expect(r.metadata.wordCount).toBe(2);
    expect(r.metadata.provider).toBe("ollama");
    expect(r.metadata.other).toBe(2);
  });

  it("stamps extractedAt as a parseable ISO timestamp", () => {
    const r = buildJsonResult("d", "m", "mistral", settings, "x", {});
    expect(Date.parse(r.extractedAt)).not.toBeNaN();
  });

  it("threads structured payload through verbatim", () => {
    const r = buildJsonResult("d", "m", "ollama", settings, "x", { foo: "bar" });
    expect(r.structured).toEqual({ foo: "bar" });
  });
});

describe("toPageCheckpoint", () => {
  it("trims preview text to 320 chars, status=completed", () => {
    const long = "a".repeat(500);
    const cp = toPageCheckpoint({ ...page, text: long });
    expect(cp.previewText).toHaveLength(320);
    expect(cp.status).toBe("completed");
  });

  it("uses raw text length for character count (untrimmed)", () => {
    expect(toPageCheckpoint(page).characterCount).toBe(page.text.length);
  });
});

describe("toPageRecord", () => {
  it("returns the recordable subset of a processed page", () => {
    expect(toPageRecord(page)).toEqual({
      pageNumber: 3,
      text: page.text,
      structured: page.structured,
      durationMs: 1234,
      metadata: { foo: "bar" },
    });
  });
});

describe("toStructuredPagePayload", () => {
  it("flattens structured fields alongside pageNumber + duration", () => {
    expect(toStructuredPagePayload(page)).toEqual({ pageNumber: 3, durationMs: 1234, markdown: "x" });
  });
});

describe("toPageResultPayload", () => {
  it("includes structured + metadata fields keyed at the top level", () => {
    expect(toPageResultPayload(page)).toEqual({
      pageNumber: 3,
      durationMs: 1234,
      structured: page.structured,
      foo: "bar",
    });
  });
});
