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

  const candidateGaps = gaps
    .sort((a, b) => b.size - a.size)
    .slice(0, 4)
    .filter((g) => g.size > pageWidth * 0.08);

  const acceptedDividers = candidateGaps
    .filter((g) => {
      const straddlers = blocks.filter((b) => b.x < g.position && b.x + b.width > g.position);
      return straddlers.length / blocks.length <= 0.2;
    })
    .sort((a, b) => a.position - b.position)
    .map((g) => g.position);

  if (acceptedDividers.length === 0) {
    return [{ columnIndex: 0, blocks: [...blocks], centerX: pageWidth / 2 }];
  }

  const columns: ColumnAssignment[] = [];
  for (let i = 0; i <= acceptedDividers.length; i++) {
    columns.push({ columnIndex: i, blocks: [], centerX: 0 });
  }

  for (const block of blocks) {
    const center = block.x + block.width / 2;
    let columnIndex = 0;
    for (let i = 0; i < acceptedDividers.length; i++) {
      if (center > acceptedDividers[i]) columnIndex = i + 1;
    }
    columns[columnIndex].blocks.push(block);
  }

  return columns
    .filter((c) => c.blocks.length / blocks.length >= 0.05)
    .map((c) => ({
      ...c,
      centerX:
        c.blocks.reduce((sum, b) => sum + (b.x + b.width / 2), 0) / c.blocks.length,
    }))
    .sort((a, b) => a.centerX - b.centerX)
    .map((c, i) => ({ ...c, columnIndex: i }));
}

function modeRoundedWeighted(blocks: AnchorTextBlock[]): number {
  if (blocks.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const b of blocks) {
    const fs = b.fontSize ?? 0;
    if (fs <= 0) continue;
    const key = Math.round(fs);
    counts.set(key, (counts.get(key) ?? 0) + b.text.length);
  }
  let best = 0;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount || (c === bestCount && (best === 0 || k < best))) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

const HEADING_TEXT_MAX_LEN = 200;

function detectHeadingLevels(blocks: AnchorTextBlock[]): number[] {
  const fontSizes = blocks.map((b) => b.fontSize ?? 0).filter((s) => s > 0);
  if (fontSizes.length < 3) return blocks.map(() => 0);
  const baseSize = modeRoundedWeighted(blocks) || 12;
  return blocks.map((b) => {
    const fs = b.fontSize ?? baseSize;
    const ratio = fs / baseSize;
    const looksLikeHeading = b.text.length > 0 && b.text.length < HEADING_TEXT_MAX_LEN;
    if (!looksLikeHeading) return 0;
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
