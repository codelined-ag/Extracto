import type { AnchorPage, AnchorTextBlock } from "@/lib/ocr/pdf-anchoring";

export interface TextLayerExtractionResult {
  markdown: string;
  columnCount: number;
  headingLevels: number[];
  blockCount: number;
}

interface ColumnAssignment {
  columnIndex: number;
  blocks: AnchorTextBlock[];
  centerX: number;
}

const COLUMN_GAP_THRESHOLD_FACTOR = 0.05;

function detectColumns(blocks: AnchorTextBlock[], pageWidth: number): ColumnAssignment[] {
  if (blocks.length === 0) return [];
  const centers = blocks.map((b) => b.x + b.width / 2);
  const sortedCenters = [...centers].sort((a, b) => a - b);

  const gaps: Array<{ position: number; size: number }> = [];
  for (let i = 1; i < sortedCenters.length; i++) {
    const gap = sortedCenters[i] - sortedCenters[i - 1];
    if (gap > pageWidth * COLUMN_GAP_THRESHOLD_FACTOR) {
      gaps.push({ position: (sortedCenters[i] + sortedCenters[i - 1]) / 2, size: gap });
    }
  }

  const significantGaps = gaps
    .sort((a, b) => b.size - a.size)
    .slice(0, 2)
    .filter((g) => g.size > pageWidth * 0.08)
    .sort((a, b) => a.position - b.position);

  if (significantGaps.length === 0) {
    return [{ columnIndex: 0, blocks: [...blocks], centerX: pageWidth / 2 }];
  }

  const dividers = significantGaps.map((g) => g.position);
  const columns: ColumnAssignment[] = [];
  for (let i = 0; i <= dividers.length; i++) {
    columns.push({ columnIndex: i, blocks: [], centerX: 0 });
  }

  for (const block of blocks) {
    const center = block.x + block.width / 2;
    let columnIndex = 0;
    for (let i = 0; i < dividers.length; i++) {
      if (center > dividers[i]) columnIndex = i + 1;
    }
    columns[columnIndex].blocks.push(block);
  }

  return columns
    .filter((c) => c.blocks.length > 0)
    .map((c) => ({
      ...c,
      centerX:
        c.blocks.reduce((sum, b) => sum + (b.x + b.width / 2), 0) / c.blocks.length,
    }))
    .sort((a, b) => a.centerX - b.centerX)
    .map((c, i) => ({ ...c, columnIndex: i }));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function detectHeadingLevels(blocks: AnchorTextBlock[]): number[] {
  const fontSizes = blocks.map((b) => b.fontSize ?? 0).filter((s) => s > 0);
  if (fontSizes.length < 3) return blocks.map(() => 0);
  const baseSize = median(fontSizes);
  return blocks.map((b) => {
    const fs = b.fontSize ?? baseSize;
    const ratio = fs / baseSize;
    if (ratio >= 1.6) return 1;
    if (ratio >= 1.35) return 2;
    if (ratio >= 1.18) return 3;
    return 0;
  });
}

function renderBlock(block: AnchorTextBlock, headingLevel: number): string {
  const text = block.text.replace(/\s+/gu, " ").trim();
  if (!text) return "";
  if (headingLevel >= 1 && headingLevel <= 6 && text.length < 200) {
    const hashes = "#".repeat(headingLevel);
    return `${hashes} ${text}`;
  }
  return text;
}

export function extractMarkdownFromTextLayer(page: AnchorPage): TextLayerExtractionResult {
  if (page.blocks.length === 0) {
    return { markdown: "", columnCount: 0, headingLevels: [], blockCount: 0 };
  }

  const columns = detectColumns(page.blocks, page.pageWidth || 1);
  const headingLevels = detectHeadingLevels(page.blocks);
  const headingByText = new Map<string, number>();
  page.blocks.forEach((block, idx) => {
    headingByText.set(`${block.x.toFixed(1)}|${block.y.toFixed(1)}|${block.text}`, headingLevels[idx]);
  });

  const sections: string[] = [];
  for (const column of columns) {
    const columnBlocks = [...column.blocks].sort((a, b) => a.y - b.y);
    const lines: string[] = [];
    for (const block of columnBlocks) {
      const heading = headingByText.get(`${block.x.toFixed(1)}|${block.y.toFixed(1)}|${block.text}`) ?? 0;
      const rendered = renderBlock(block, heading);
      if (rendered) lines.push(rendered);
    }
    sections.push(lines.join("\n\n"));
  }

  return {
    markdown: sections.filter(Boolean).join("\n\n"),
    columnCount: columns.length,
    headingLevels,
    blockCount: page.blocks.length,
  };
}
