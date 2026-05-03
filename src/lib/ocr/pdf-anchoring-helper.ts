import { extractPdfAnchoring, type AnchorPage } from "@/lib/ocr/pdf-anchoring";

export async function extractAnchorsForPages(
  sourcePdf: string | undefined,
  pageNumbers: number[] | undefined,
  expectedLength: number,
): Promise<AnchorPage[] | undefined> {
  if (!sourcePdf) return undefined;
  const isPdfDataUrl = /^data:application\/(?:x-)?pdf/u.test(sourcePdf);
  if (!isPdfDataUrl) return undefined;
  const requestedPages = pageNumbers && pageNumbers.length === expectedLength ? pageNumbers : undefined;
  let result;
  try {
    result = await extractPdfAnchoring(sourcePdf, { pageNumbers: requestedPages });
  } catch (error) {
    console.warn(`extractPdfAnchoring failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (!result) return undefined;

  const indices = pageNumbers && pageNumbers.length === expectedLength
    ? pageNumbers
    : Array.from({ length: expectedLength }, (_, i) => i + 1);
  const aligned: AnchorPage[] = [];
  for (const pageNumber of indices) {
    const match = result.pages.find((p) => p.pageNumber === pageNumber);
    if (!match) {
      aligned.push({
        pageNumber,
        pageWidth: 0,
        pageHeight: 0,
        blocks: [],
        rawText: "",
        characterCount: 0,
      });
    } else {
      aligned.push(match);
    }
  }
  return aligned;
}
