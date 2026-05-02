import { describe, it, expect } from "vitest";
import {
  buildPostProcessingPrompt,
  computeTextStats,
  formatPageScopedText,
  normalizePostProcessedText,
} from "@/lib/ocr/pipeline-post-processing";

describe("buildPostProcessingPrompt", () => {
  it("emits a system + user prompt with the user instruction inlined", () => {
    const out = buildPostProcessingPrompt({
      enabled: true,
      instruction: "extract names",
      outputFormat: "markdown",
      model: "",
    });
    expect(out.systemPrompt).toMatch(/precise post-processing assistant/);
    expect(out.userPrompt).toContain("extract names");
    expect(out.userPrompt).toContain("Return markdown only");
  });

  it("switches the output instruction to JSON when requested", () => {
    const out = buildPostProcessingPrompt({
      enabled: true,
      instruction: "anything",
      outputFormat: "json",
      model: "",
    });
    expect(out.userPrompt).toContain("Return only valid JSON");
  });
});

describe("formatPageScopedText", () => {
  it("emits PAGE / END PAGE markers around each page", () => {
    const text = formatPageScopedText([
      { pageNumber: 1, text: "first" },
      { pageNumber: 2, text: "second" },
    ]);
    expect(text).toBe("[PAGE 1]\nfirst\n[END PAGE 1]\n\n[PAGE 2]\nsecond\n[END PAGE 2]");
  });

  it("trims each page's text", () => {
    expect(formatPageScopedText([{ pageNumber: 7, text: "  hi  " }])).toContain("[PAGE 7]\nhi\n[END PAGE 7]");
  });
});

describe("computeTextStats", () => {
  it("counts characters, words, lines on the trimmed input", () => {
    expect(computeTextStats("  hello world\nfoo bar\n  ")).toEqual({
      characterCount: 19,
      wordCount: 4,
      lineCount: 2,
    });
  });

  it("returns zeros for empty/whitespace input", () => {
    expect(computeTextStats("")).toEqual({ characterCount: 0, wordCount: 0, lineCount: 0 });
    expect(computeTextStats("   \n\t  ")).toEqual({ characterCount: 0, wordCount: 0, lineCount: 0 });
  });
});

describe("normalizePostProcessedText", () => {
  it("returns trimmed input unchanged for markdown format", () => {
    expect(normalizePostProcessedText("  # heading  ", "markdown")).toEqual({ text: "# heading" });
  });

  it("parses JSON and returns formatted output + parsedJson", () => {
    const out = normalizePostProcessedText('{"a":1,"b":[2,3]}', "json");
    expect(out.parsedJson).toEqual({ a: 1, b: [2, 3] });
    expect(out.text).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2));
  });

  it("strips markdown code fences (```json ... ```) when extracting JSON", () => {
    const out = normalizePostProcessedText('```json\n{"k":"v"}\n```', "json");
    expect(out.parsedJson).toEqual({ k: "v" });
  });

  it("returns trimmed input when JSON parse fails", () => {
    const out = normalizePostProcessedText("not json {", "json");
    expect(out.text).toBe("not json {");
    expect(out.parsedJson).toBeUndefined();
  });
});
