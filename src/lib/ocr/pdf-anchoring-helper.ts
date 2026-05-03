import { extractPdfAnchoring, type AnchorPage } from "@/lib/ocr/pdf-anchoring";

export async function extractAnchorsForPages(
  sourcePdf: string | undefined,
  pageNumbers: number[] | undefined,
  expectedLength: number,
): Promise<AnchorPage[] | undefined> {
  if (!sourcePdf) return undefined;
  if (!sourcePdf.startsWith("data:application/pdf")) return undefined;
  let result;
  try {
    result = await extractPdfAnchoring(sourcePdf);
  } catch {
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
