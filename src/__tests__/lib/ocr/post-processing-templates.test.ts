import { describe, expect, it } from "vitest";

import {
  isPostProcessTemplate,
  resolveTemplateInstruction,
  sanitizeTargetLanguage,
} from "@/lib/ocr/post-processing-templates";
import { sanitizePostProcessing } from "@/lib/ocr/job-input-helpers";

describe("isPostProcessTemplate", () => {
  it("accepts known templates", () => {
    expect(isPostProcessTemplate("custom")).toBe(true);
    expect(isPostProcessTemplate("translate")).toBe(true);
    expect(isPostProcessTemplate("summarize-3sentence")).toBe(true);
    expect(isPostProcessTemplate("summarize-executive")).toBe(true);
    expect(isPostProcessTemplate("extract-actions")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isPostProcessTemplate("random")).toBe(false);
    expect(isPostProcessTemplate("")).toBe(false);
    expect(isPostProcessTemplate(undefined)).toBe(false);
    expect(isPostProcessTemplate(123)).toBe(false);
  });
});

describe("sanitizeTargetLanguage", () => {
  it("trims and accepts a plain language name", () => {
    expect(sanitizeTargetLanguage("  Italian ")).toBe("Italian");
    expect(sanitizeTargetLanguage("Brazilian Portuguese")).toBe("Brazilian Portuguese");
    expect(sanitizeTargetLanguage("zh-CN")).toBe("zh-CN");
  });

  it("rejects empty / non-string / weird-character input", () => {
    expect(sanitizeTargetLanguage("")).toBe("");
    expect(sanitizeTargetLanguage(undefined)).toBe("");
    expect(sanitizeTargetLanguage("rm -rf /; ")).toBe("");
    expect(sanitizeTargetLanguage("<script>x</script>")).toBe("");
  });

  it("caps length at 80 chars", () => {
    expect(sanitizeTargetLanguage("a".repeat(200)).length).toBe(80);
  });
});

describe("resolveTemplateInstruction", () => {
  it("returns custom instruction unchanged for custom template", () => {
    expect(
      resolveTemplateInstruction({ template: "custom", customInstruction: "extract names" }),
    ).toBe("extract names");
  });

  it("returns empty string for translate without targetLanguage", () => {
    expect(resolveTemplateInstruction({ template: "translate", targetLanguage: "" })).toBe("");
  });

  it("emits a translate instruction with the target language inlined", () => {
    const instruction = resolveTemplateInstruction({
      template: "translate",
      targetLanguage: "French",
    });
    expect(instruction).toContain("French");
    expect(instruction).toContain("Translate");
    expect(instruction).toContain("Preserve every heading");
  });

  it("emits a 3-sentence summary instruction", () => {
    const instruction = resolveTemplateInstruction({ template: "summarize-3sentence" });
    expect(instruction).toContain("three sentences");
  });

  it("emits an executive summary instruction", () => {
    const instruction = resolveTemplateInstruction({ template: "summarize-executive" });
    expect(instruction).toContain("executive summary");
  });

  it("emits an extract-actions instruction", () => {
    const instruction = resolveTemplateInstruction({ template: "extract-actions" });
    expect(instruction).toContain("action items");
    expect(instruction).toContain("No action items found");
  });
});

describe("sanitizePostProcessing — template integration", () => {
  it("disables postProcessing when translate has no target language", () => {
    const out = sanitizePostProcessing({
      enabled: true,
      template: "translate",
      targetLanguage: "",
      instruction: "",
      outputFormat: "markdown",
      model: "",
    });
    expect(out.enabled).toBe(false);
    expect(out.instruction).toBe("");
  });

  it("enables postProcessing with a server-built instruction when translate has a target language", () => {
    const out = sanitizePostProcessing({
      enabled: true,
      template: "translate",
      targetLanguage: "Italian",
      instruction: "anything user typed earlier; should be ignored",
      outputFormat: "markdown",
      model: "openai/gpt-4o",
    });
    expect(out.enabled).toBe(true);
    expect(out.instruction).toContain("Italian");
    expect(out.template).toBe("translate");
    expect(out.targetLanguage).toBe("Italian");
  });

  it("falls back to custom instruction when template is unrecognized", () => {
    const out = sanitizePostProcessing({
      enabled: true,
      template: "bogus" as unknown as "custom",
      targetLanguage: "Italian",
      instruction: "free form",
      outputFormat: "markdown",
      model: "",
    });
    expect(out.template).toBe("custom");
    expect(out.instruction).toBe("free form");
  });
});
