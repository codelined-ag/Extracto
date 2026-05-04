import { extractPdfAnchoring, type AnchorPage } from "@/lib/ocr/pdf-anchoring";

export async function extractAnchorsForPages(
  sourcePdf: string | undefined,
  pageNumbers: number[] | undefined,
  expectedLength: number,
): Promise<AnchorPage[] | undefined> {
  if (!sourcePdf) return undefined;
  const isPdfDataUrl = /^data:application\/(?:x-)?pdf/u.test(sourcePdf);
  if (!isPdfDataUrl) return undefined;
  if (!pageNumbers || pageNumbers.length !== expectedLength) return undefined;
  let result;
  try {
    result = await extractPdfAnchoring(sourcePdf, { pageNumbers });
  } catch (error) {
    console.warn(`extractPdfAnchoring failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (!result) return undefined;

  const aligned: AnchorPage[] = [];
  for (const pageNumber of pageNumbers) {
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
