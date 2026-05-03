import { describe, it, expect } from "vitest";

import { buildAnchoredOcrPrompt, maybeApplyAnchoring } from "@/lib/ocr/anchoring-prompt";
import type { AnchorPage } from "@/lib/ocr/pdf-anchoring";

function makePage(overrides: Partial<AnchorPage> = {}): AnchorPage {
  return {
    pageNumber: 1,
    pageWidth: 612,
    pageHeight: 792,
    blocks: [
      { text: "Title", x: 100, y: 50, width: 200, height: 24, fontSize: 24 },
      { text: "Body paragraph here.", x: 72, y: 100, width: 400, height: 14, fontSize: 12 },
    ],
    rawText: "Title\nBody paragraph here.",
    characterCount: 30,
    ...overrides,
  };
}

describe("buildAnchoredOcrPrompt", () => {
  it("returns the base prompt when no blocks present", () => {
    const page = makePage({ blocks: [] });
    const result = buildAnchoredOcrPrompt("OCR this", page);
    expect(result).toBe("OCR this");
  });

  it("includes block coordinates in the prompt", () => {
    const result = buildAnchoredOcrPrompt("OCR this", makePage());
    expect(result).toContain("DOCUMENT-ANCHORING CONTEXT");
    expect(result).toContain("Title");
    expect(result).toContain("Body paragraph here.");
    expect(result).toContain("[100,50,200x24");
    expect(result).toContain("OCR this");
  });

  it("respects maxAnchorChars", () => {
    const blocks = Array.from({ length: 100 }, (_, i) => ({
      text: `Block ${i} with some text content`,
      x: 72,
      y: 50 + i * 14,
      width: 400,
      height: 14,
      fontSize: 12,
    }));
    const page = makePage({ blocks });
    const result = buildAnchoredOcrPrompt("base", page, { maxAnchorChars: 200 });
    expect(result.length).toBeLessThan(2000);
    expect(result).toContain("base");
  });

  it("respects blockLimit", () => {
    const blocks = Array.from({ length: 50 }, (_, i) => ({
      text: `B${i}`,
      x: 0, y: i * 14, width: 10, height: 14, fontSize: 12,
    }));
    const result = buildAnchoredOcrPrompt("base", makePage({ blocks }), { blockLimit: 5 });
    expect(result).toContain("B0");
    expect(result).toContain("B4");
    expect(result).not.toContain("B10");
  });

  it("excludes font hints when disabled", () => {
    const result = buildAnchoredOcrPrompt("base", makePage(), { includeFontHints: false });
    expect(result).not.toMatch(/\d+pt/u);
  });
});

describe("maybeApplyAnchoring", () => {
  it("returns base prompt when anchor is undefined", () => {
    const r = maybeApplyAnchoring("base", undefined);
    expect(r.prompt).toBe("base");
    expect(r.usedAnchoring).toBe(false);
  });

  it("returns base prompt when characterCount is too low", () => {
    const r = maybeApplyAnchoring("base", makePage({ characterCount: 5 }));
    expect(r.prompt).toBe("base");
    expect(r.usedAnchoring).toBe(false);
  });

  it("returns enriched prompt when anchor is rich", () => {
    const r = maybeApplyAnchoring("base", makePage());
    expect(r.usedAnchoring).toBe(true);
    expect(r.prompt).toContain("DOCUMENT-ANCHORING CONTEXT");
  });
});
