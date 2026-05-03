import { describe, it, expect } from "vitest";

import { extractMarkdownFromTextLayer } from "@/lib/ocr/text-layer-extraction";
import type { AnchorPage } from "@/lib/ocr/pdf-anchoring";

function makePage(blocks: AnchorPage["blocks"], pageWidth = 612): AnchorPage {
  return {
    pageNumber: 1,
    pageWidth,
    pageHeight: 792,
    blocks,
    rawText: blocks.map((b) => b.text).join("\n"),
    characterCount: blocks.reduce((sum, b) => sum + b.text.length, 0),
  };
}

describe("extractMarkdownFromTextLayer: empty + degenerate", () => {
  it("returns empty result on empty page", () => {
    const r = extractMarkdownFromTextLayer(makePage([]));
    expect(r.markdown).toBe("");
    expect(r.columnCount).toBe(0);
    expect(r.blockCount).toBe(0);
  });

  it("renders a single text block as plain markdown", () => {
    const r = extractMarkdownFromTextLayer(
      makePage([{ text: "hello world", x: 72, y: 50, width: 200, height: 14, fontSize: 12 }]),
    );
    expect(r.markdown).toBe("hello world");
    expect(r.columnCount).toBe(1);
  });
});

describe("extractMarkdownFromTextLayer: heading detection", () => {
  it("renders larger fonts as headings (#, ##, ###)", () => {
    const r = extractMarkdownFromTextLayer(
      makePage([
        { text: "Big Title", x: 72, y: 30, width: 400, height: 24, fontSize: 24 },
        { text: "Subhead", x: 72, y: 60, width: 400, height: 16, fontSize: 16 },
        { text: "Body text here.", x: 72, y: 90, width: 400, height: 12, fontSize: 12 },
        { text: "More body text.", x: 72, y: 110, width: 400, height: 12, fontSize: 12 },
        { text: "Even more body.", x: 72, y: 130, width: 400, height: 12, fontSize: 12 },
      ]),
    );
    expect(r.markdown).toContain("# Big Title");
    expect(r.markdown).toContain("## Subhead");
    expect(r.markdown).toContain("Body text here.");
  });
});

describe("extractMarkdownFromTextLayer: column detection + reading order", () => {
  it("detects two columns and emits left column before right column", () => {
    const r = extractMarkdownFromTextLayer(
      makePage([
        { text: "Left top", x: 50, y: 100, width: 200, height: 12, fontSize: 12 },
        { text: "Right top", x: 350, y: 100, width: 200, height: 12, fontSize: 12 },
        { text: "Left bottom", x: 50, y: 200, width: 200, height: 12, fontSize: 12 },
        { text: "Right bottom", x: 350, y: 200, width: 200, height: 12, fontSize: 12 },
      ]),
    );
    expect(r.columnCount).toBe(2);
    const leftIdx = r.markdown.indexOf("Left top");
    const rightIdx = r.markdown.indexOf("Right top");
    expect(leftIdx).toBeLessThan(rightIdx);
    expect(r.markdown.indexOf("Left bottom")).toBeLessThan(r.markdown.indexOf("Right bottom"));
  });

  it("preserves top-to-bottom order within a single column", () => {
    const r = extractMarkdownFromTextLayer(
      makePage([
        { text: "Third (lowest)", x: 100, y: 300, width: 200, height: 12, fontSize: 12 },
        { text: "First (highest)", x: 100, y: 50, width: 200, height: 12, fontSize: 12 },
        { text: "Second (middle)", x: 100, y: 150, width: 200, height: 12, fontSize: 12 },
      ]),
    );
    const order = r.markdown.split(/\n+/);
    expect(order.indexOf("First (highest)")).toBeLessThan(order.indexOf("Second (middle)"));
    expect(order.indexOf("Second (middle)")).toBeLessThan(order.indexOf("Third (lowest)"));
  });
});
