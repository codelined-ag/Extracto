import { describe, it, expect } from "vitest";
import {
  seedExtractedText,
  seedPostProcessingMeta,
  seedUsedOllamaModels,
  type SeedablePageOutput,
} from "@/lib/ocr/job-seed";
import type { PostProcessingSettings } from "@/lib/ocr/settings";

const makePage = (
  pageNumber: number,
  text: string,
  structured: Record<string, unknown> = {},
): SeedablePageOutput => ({
  pageNumber,
  text,
  structured,
  durationMs: 100,
});

describe("seedExtractedText", () => {
  it("returns empty state when no pages", () => {
    expect(seedExtractedText([])).toEqual({ text: "", chunks: 0 });
  });

  it("accumulates a single page", () => {
    expect(seedExtractedText([makePage(1, "hello")])).toEqual({ text: "hello", chunks: 1 });
  });

  it("joins multiple pages with the chunk separator", () => {
    expect(seedExtractedText([makePage(1, "alpha"), makePage(2, "beta")])).toEqual({
      text: "alpha\n\n---\n\nbeta",
      chunks: 2,
    });
  });

  it("skips empty/whitespace-only pages without bumping the chunk count", () => {
    const result = seedExtractedText([
      makePage(1, "alpha"),
      makePage(2, ""),
      makePage(3, "   "),
      makePage(4, "beta"),
    ]);
    expect(result.chunks).toBe(2);
    expect(result.text).toBe("alpha\n\n---\n\nbeta");
  });

  it("uses structured.markdown when present (delegates to appendPageMarkdown)", () => {
    expect(
      seedExtractedText([makePage(1, "raw fallback", { markdown: "# Pretty heading" })]),
    ).toEqual({
      text: "# Pretty heading",
      chunks: 1,
    });
  });
});

describe("seedUsedOllamaModels", () => {
  it("includes the OCR model when provider=ollama", () => {
    const set = seedUsedOllamaModels("ollama", "llava:13b");
    expect(set.has("llava:13b")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("returns an empty set for non-ollama providers", () => {
    expect(seedUsedOllamaModels("mistral", "mistral-ocr-latest").size).toBe(0);
    expect(seedUsedOllamaModels("openrouter", "openai/gpt-4o").size).toBe(0);
    expect(seedUsedOllamaModels("openai_compat", "gpt-4o").size).toBe(0);
  });

  it("returns a fresh Set on each call (no shared state across jobs)", () => {
    const a = seedUsedOllamaModels("ollama", "x");
    const b = seedUsedOllamaModels("ollama", "y");
    expect(a).not.toBe(b);
    expect(a.has("x")).toBe(true);
    expect(b.has("y")).toBe(true);
    expect(a.has("y")).toBe(false);
  });
});

describe("seedPostProcessingMeta", () => {
  const baseDisabled: PostProcessingSettings = {
    enabled: false,
    instruction: "",
    outputFormat: "markdown",
    model: "",
  };
  const baseEnabled: PostProcessingSettings = {
    enabled: true,
    instruction: "Extract tables as JSON arrays",
    outputFormat: "json",
    model: "",
  };

  it("returns only { enabled: false } when disabled", () => {
    const meta = seedPostProcessingMeta(baseDisabled, "any-model");
    expect(meta).toEqual({ enabled: false });
    expect("outputFormat" in meta).toBe(false);
    expect("instruction" in meta).toBe(false);
    expect("model" in meta).toBe(false);
  });

  it("populates outputFormat/instruction/model when enabled", () => {
    const meta = seedPostProcessingMeta(baseEnabled, "gpt-4o");
    expect(meta).toEqual({
      enabled: true,
      outputFormat: "json",
      instruction: "Extract tables as JSON arrays",
      model: "gpt-4o",
    });
  });

  it("uses the postProcessingModel parameter even if payload.model is set", () => {
    // The route resolves payload.model || base model BEFORE calling this
    // helper; the seed itself just trusts the resolved model passed in.
    const meta = seedPostProcessingMeta(
      { ...baseEnabled, model: "ignored-by-payload" },
      "actually-used",
    );
    expect(meta.model).toBe("actually-used");
  });

  it("preserves the markdown outputFormat option", () => {
    const meta = seedPostProcessingMeta(
      { ...baseEnabled, outputFormat: "markdown" },
      "model-x",
    );
    expect(meta.outputFormat).toBe("markdown");
  });
});
