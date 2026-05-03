export interface AnchorTextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontName?: string;
}

export interface AnchorPage {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  blocks: AnchorTextBlock[];
  rawText: string;
  characterCount: number;
}

export interface PdfAnchoringResult {
  pageCount: number;
  pages: AnchorPage[];
}

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}

interface PdfJsTextContent {
  items: Array<PdfJsTextItem | { type?: string }>;
}

interface PdfJsViewport {
  width: number;
  height: number;
}

interface PdfJsPage {
  getTextContent(): Promise<PdfJsTextContent>;
  getViewport(input: { scale: number }): PdfJsViewport;
}

interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  destroy(): Promise<void>;
}

interface PdfJsLib {
  getDocument(input: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    disableFontFace?: boolean;
    isEvalSupported?: boolean;
    verbosity?: number;
  }): {
    promise: Promise<PdfJsDocument>;
  };
  GlobalWorkerOptions?: { workerSrc?: string };
}

let pdfJsLibPromise: Promise<PdfJsLib> | null = null;

async function loadPdfJs(): Promise<PdfJsLib> {
  if (pdfJsLibPromise) return pdfJsLibPromise;
  pdfJsLibPromise = (async () => {
    const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsLib;
    if (mod.GlobalWorkerOptions) {
      mod.GlobalWorkerOptions.workerSrc = "";
    }
    return mod;
  })();
  return pdfJsLibPromise;
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)(?:;base64)?,([\s\S]*)$/u.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const isBase64 = dataUrl.includes(";base64,");
  const payload = match[2];
  if (isBase64) {
    return { mime, bytes: Uint8Array.from(Buffer.from(payload, "base64")) };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
}

function isPdfMime(mime: string): boolean {
  return mime === "application/pdf" || mime === "application/x-pdf";
}

const FONTSIZE_TOLERANCE = 0.5;
const Y_TOLERANCE_FACTOR = 0.45;
const SPACE_GAP_MIN_FACTOR = 0.15;
const SUPERSCRIPT_FONT_RATIO = 0.85;

interface RawSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
}

function rawSpansFromTextContent(content: PdfJsTextContent, pageHeight: number): RawSpan[] {
  const spans: RawSpan[] = [];
  for (const item of content.items) {
    if (!item || typeof item !== "object") continue;
    if (!("str" in item) || typeof (item as PdfJsTextItem).str !== "string") continue;
    const txtItem = item as PdfJsTextItem;
    const text = txtItem.str;
    if (!text) continue;
    const transform = txtItem.transform;
    if (!Array.isArray(transform) || transform.length < 6) continue;
    const fontSize = Math.abs(transform[3]) || Math.abs(transform[0]) || 0;
    const x = transform[4];
    const yPdf = transform[5];
    const width = txtItem.width || 0;
    const height = txtItem.height || fontSize;
    spans.push({
      text,
      x,
      y: pageHeight - yPdf - (fontSize || height),
      width,
      height,
      fontSize,
      fontName: txtItem.fontName,
    });
  }
  return spans;
}

const RTL_RANGE_REGEX = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/u;

function isRtlText(text: string): boolean {
  return RTL_RANGE_REGEX.test(text);
}

function mergeSpansIntoBlocks(spans: RawSpan[]): AnchorTextBlock[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => {
    const yTolerance = Math.max(a.fontSize, b.fontSize, 1) * Y_TOLERANCE_FACTOR;
    if (Math.abs(a.y - b.y) > yTolerance) return a.y - b.y;
    if (isRtlText(a.text) && isRtlText(b.text)) return b.x - a.x;
    return a.x - b.x;
  });

  const blocks: AnchorTextBlock[] = [];
  let current: {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontName?: string;
    rightEdge: number;
  } | null = null;

  for (const span of sorted) {
    const trimmed = span.text;
    if (!trimmed) continue;
    if (!current) {
      current = {
        text: trimmed,
        x: span.x,
        y: span.y,
        width: span.width,
        height: span.height,
        fontSize: span.fontSize,
        fontName: span.fontName,
        rightEdge: span.x + span.width,
      };
      continue;
    }
    const yTolerance = Math.max(current.fontSize, span.fontSize, 1) * Y_TOLERANCE_FACTOR;
    const verticalDelta = Math.abs(span.y - current.y);
    const sameLine = verticalDelta <= yTolerance;
    const isSuperOrSubScript =
      verticalDelta <= current.fontSize * 0.65 &&
      span.fontSize > 0 &&
      span.fontSize < current.fontSize * SUPERSCRIPT_FONT_RATIO;
    const sameStyle =
      Math.abs(span.fontSize - current.fontSize) <= FONTSIZE_TOLERANCE &&
      span.fontName === current.fontName;
    const horizontalGap = span.x - current.rightEdge;
    const closeEnough = horizontalGap >= -2 && horizontalGap <= current.fontSize * 1.5;
    if ((sameLine && sameStyle && closeEnough) || (sameLine && isSuperOrSubScript)) {
      const needsSpace =
        horizontalGap > current.fontSize * SPACE_GAP_MIN_FACTOR &&
        !current.text.endsWith(" ") &&
        !trimmed.startsWith(" ");
      current.text += (needsSpace ? " " : "") + trimmed;
      current.width = Math.max(current.width, span.x + span.width - current.x);
      current.rightEdge = Math.max(current.rightEdge, span.x + span.width);
      current.height = Math.max(current.height, span.height);
      continue;
    }
    blocks.push({
      text: current.text,
      x: current.x,
      y: current.y,
      width: current.width,
      height: current.height,
      fontSize: current.fontSize,
      fontName: current.fontName,
    });
    current = {
      text: trimmed,
      x: span.x,
      y: span.y,
      width: span.width,
      height: span.height,
      fontSize: span.fontSize,
      fontName: span.fontName,
      rightEdge: span.x + span.width,
    };
  }
  if (current) {
    blocks.push({
      text: current.text,
      x: current.x,
      y: current.y,
      width: current.width,
      height: current.height,
      fontSize: current.fontSize,
      fontName: current.fontName,
    });
  }
  return blocks;
}

function blockText(blocks: AnchorTextBlock[]): string {
  return blocks
    .map((b) => b.text.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export interface ExtractPdfAnchoringOptions {
  pageNumbers?: number[];
}

export async function extractPdfAnchoring(
  input: Uint8Array | string,
  options: ExtractPdfAnchoringOptions = {},
): Promise<PdfAnchoringResult | null> {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    const parsed = parseDataUrl(input);
    if (!parsed) return null;
    if (!isPdfMime(parsed.mime)) return null;
    bytes = parsed.bytes;
  } else {
    bytes = input;
  }
  if (bytes.byteLength < 8) return null;
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  if (!header.startsWith("%PDF-")) return null;

  let lib: PdfJsLib;
  try {
    lib = await loadPdfJs();
  } catch (error) {
    console.warn(`pdfjs load failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  let doc: PdfJsDocument;
  try {
    const loading = lib.getDocument({
      data: bytes,
      useSystemFonts: false,
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    doc = await loading.promise;
  } catch (error) {
    console.warn(`pdfjs getDocument failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const pageCount = doc.numPages;
  const requestedSet = options.pageNumbers && options.pageNumbers.length > 0
    ? new Set(options.pageNumbers.filter((n) => Number.isInteger(n) && n >= 1 && n <= pageCount))
    : null;
  const pages: AnchorPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      if (requestedSet && !requestedSet.has(pageNumber)) continue;
      try {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const spans = rawSpansFromTextContent(content, viewport.height);
        const blocks = mergeSpansIntoBlocks(spans);
        const rawText = blockText(blocks);
        pages.push({
          pageNumber,
          pageWidth: viewport.width,
          pageHeight: viewport.height,
          blocks,
          rawText,
          characterCount: rawText.length,
        });
      } catch (error) {
        console.warn(`pdfjs page ${pageNumber} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return { pageCount, pages };
}

export interface TextLayerQuality {
  hasText: boolean;
  characterCount: number;
  blockCount: number;
  avgBlockLength: number;
  alphaRatio: number;
  wordShapeRatio: number;
  isLikelyImageOnly: boolean;
  isLikelyJunkOcr: boolean;
  isHighConfidence: boolean;
}

const WORD_SHAPE_REGEX = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{1,}$/u;

function computeAlphaRatio(text: string): number {
  if (text.length === 0) return 0;
  let alpha = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 192 && ch <= 255) || (ch >= 0x4e00 && ch <= 0x9fff)) {
      alpha++;
    }
  }
  return alpha / text.length;
}

function computeWordShapeRatio(text: string): number {
  const tokens = text.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return 0;
  let matches = 0;
  for (const token of tokens) {
    if (WORD_SHAPE_REGEX.test(token)) matches++;
  }
  return matches / tokens.length;
}

export function assessTextLayerQuality(page: AnchorPage): TextLayerQuality {
  const blockCount = page.blocks.length;
  const characterCount = page.characterCount;
  const avgBlockLength = blockCount > 0 ? characterCount / blockCount : 0;
  const hasText = characterCount > 0;
  const isLikelyImageOnly = characterCount < 20;
  const alphaRatio = computeAlphaRatio(page.rawText);
  const wordShapeRatio = computeWordShapeRatio(page.rawText);
  const isLikelyJunkOcr = hasText && (alphaRatio < 0.55 || wordShapeRatio < 0.35);
  const isHighConfidence =
    characterCount >= 200 &&
    blockCount >= 3 &&
    avgBlockLength >= 12 &&
    !isLikelyJunkOcr;
  return {
    hasText,
    characterCount,
    blockCount,
    avgBlockLength,
    alphaRatio,
    wordShapeRatio,
    isLikelyImageOnly,
    isLikelyJunkOcr,
    isHighConfidence,
  };
}
