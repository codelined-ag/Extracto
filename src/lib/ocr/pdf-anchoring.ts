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
  getDocument(input: { data: Uint8Array; useSystemFonts?: boolean }): {
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
const Y_TOLERANCE = 1.5;
const SPACE_GAP_FACTOR = 0.4;

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
      y: pageHeight - yPdf - height,
      width,
      height,
      fontSize,
      fontName: txtItem.fontName,
    });
  }
  return spans;
}

function mergeSpansIntoBlocks(spans: RawSpan[]): AnchorTextBlock[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => {
    if (Math.abs(a.y - b.y) > Y_TOLERANCE) return a.y - b.y;
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
    const sameLine = Math.abs(span.y - current.y) <= Y_TOLERANCE;
    const sameStyle =
      Math.abs(span.fontSize - current.fontSize) <= FONTSIZE_TOLERANCE &&
      span.fontName === current.fontName;
    const horizontalGap = span.x - current.rightEdge;
    const tinyGap = horizontalGap >= -2 && horizontalGap <= span.fontSize * SPACE_GAP_FACTOR;
    if (sameLine && sameStyle && tinyGap) {
      const needsSpace =
        horizontalGap > 0 &&
        !current.text.endsWith(" ") &&
        !trimmed.startsWith(" ");
      current.text += (needsSpace ? " " : "") + trimmed;
      current.width = span.x + span.width - current.x;
      current.rightEdge = span.x + span.width;
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

export async function extractPdfAnchoring(input: Uint8Array | string): Promise<PdfAnchoringResult | null> {
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

  const lib = await loadPdfJs();
  const loading = lib.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await loading.promise;
  const pages: AnchorPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
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
    }
  } finally {
    await doc.destroy().catch(() => undefined);
  }
  return { pageCount: doc.numPages, pages };
}

export interface TextLayerQuality {
  hasText: boolean;
  characterCount: number;
  blockCount: number;
  avgBlockLength: number;
  isLikelyImageOnly: boolean;
  isHighConfidence: boolean;
}

export function assessTextLayerQuality(page: AnchorPage): TextLayerQuality {
  const blockCount = page.blocks.length;
  const characterCount = page.characterCount;
  const avgBlockLength = blockCount > 0 ? characterCount / blockCount : 0;
  const hasText = characterCount > 0;
  const isLikelyImageOnly = characterCount < 20;
  const isHighConfidence = characterCount >= 200 && blockCount >= 3 && avgBlockLength >= 12;
  return {
    hasText,
    characterCount,
    blockCount,
    avgBlockLength,
    isLikelyImageOnly,
    isHighConfidence,
  };
}
