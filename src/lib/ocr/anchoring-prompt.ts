import type { AnchorPage, AnchorTextBlock } from "@/lib/ocr/pdf-anchoring";

export interface AnchorPromptOptions {
  maxAnchorChars?: number;
  blockLimit?: number;
  includeFontHints?: boolean;
}

const DEFAULT_MAX_ANCHOR_CHARS = 8_000;
const DEFAULT_BLOCK_LIMIT = 200;

function blockLine(block: AnchorTextBlock, includeFontHints: boolean): string {
  const x = Math.round(block.x);
  const y = Math.round(block.y);
  const w = Math.round(block.width);
  const h = Math.round(block.height);
  const text = block.text.replace(/\s+/gu, " ").trim();
  if (!text) return "";
  if (includeFontHints && typeof block.fontSize === "number" && block.fontSize > 0) {
    return `[${x},${y},${w}x${h},${Math.round(block.fontSize)}pt] ${text}`;
  }
  return `[${x},${y},${w}x${h}] ${text}`;
}

export function buildAnchoredOcrPrompt(
  basePrompt: string,
  anchor: AnchorPage,
  options: AnchorPromptOptions = {},
): string {
  const maxChars = options.maxAnchorChars ?? DEFAULT_MAX_ANCHOR_CHARS;
  const blockLimit = options.blockLimit ?? DEFAULT_BLOCK_LIMIT;
  const includeFontHints = options.includeFontHints ?? true;

  if (!anchor.blocks || anchor.blocks.length === 0) {
    return basePrompt;
  }

  const lines: string[] = [];
  let usedChars = 0;
  for (const block of anchor.blocks.slice(0, blockLimit)) {
    const line = blockLine(block, includeFontHints);
    if (!line) continue;
    if (usedChars + line.length + 1 > maxChars) break;
    lines.push(line);
    usedChars += line.length + 1;
  }
  if (lines.length === 0) {
    return basePrompt;
  }

  const guidance = [
    "DOCUMENT-ANCHORING CONTEXT",
    `The PDF text layer for this page already contains ${anchor.blocks.length} text block(s) at the following positions (origin top-left, points):`,
    "",
    ...lines,
    "",
    "INSTRUCTIONS",
    "- Treat the text-layer entries above as authoritative ground truth for character content and reading-position.",
    "- Reconcile against the rendered page image; correct OCR-style mistakes (broken ligatures, mis-recognized punctuation) using the ground-truth blocks.",
    "- Preserve heading hierarchy. If the text layer reveals headings (larger font sizes), reflect that in markdown (#, ##, ###).",
    "- Re-build a coherent reading order: top-to-bottom within columns, left-to-right across columns, footnotes after main body.",
    "- Do NOT invent text that is not present in either the text-layer blocks OR clearly visible in the image.",
    "- If a region (table, equation, figure caption) is visually present but missing from the blocks, render it from the image only.",
    "",
    "TASK",
    basePrompt.trim(),
  ];
  return guidance.join("\n");
}

export interface AnchoringPromptDecision {
  prompt: string;
  usedAnchoring: boolean;
}

export function maybeApplyAnchoring(
  basePrompt: string,
  anchor: AnchorPage | undefined,
  options: AnchorPromptOptions = {},
): AnchoringPromptDecision {
  if (!anchor || anchor.characterCount < 20 || anchor.blocks.length === 0) {
    return { prompt: basePrompt, usedAnchoring: false };
  }
  return {
    prompt: buildAnchoredOcrPrompt(basePrompt, anchor, options),
    usedAnchoring: true,
  };
}
