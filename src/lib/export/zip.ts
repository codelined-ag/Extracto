import JSZip from "jszip";

export interface ZipExportInput {
  fileName?: string | null;
  extractedText: string;
  result?: unknown;
}

interface PageRecord {
  pageNumber: number;
  markdown: string;
}

export async function buildJobZip(input: ZipExportInput): Promise<Buffer> {
  const zip = new JSZip();
  const pages = collectPages(input.result, input.extractedText);
  const stem = sanitizeStem(input.fileName ?? "extracto-job");

  zip.file(`${stem}/index.md`, buildIndex(stem, pages));
  for (const page of pages) {
    const padded = String(page.pageNumber).padStart(3, "0");
    zip.file(`${stem}/pages/page-${padded}.md`, page.markdown.trim() + "\n");
  }
  zip.file(`${stem}/all-pages.md`, joinPages(pages));

  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function collectPages(result: unknown, fallbackMarkdown: string): PageRecord[] {
  if (result && typeof result === "object") {
    const r = result as { structured?: { pages?: unknown[] } };
    const pages = r.structured?.pages;
    if (Array.isArray(pages) && pages.length > 0) {
      const out: PageRecord[] = [];
      for (const page of pages) {
        if (!page || typeof page !== "object") continue;
        const p = page as { pageNumber?: unknown; markdown?: unknown; text?: unknown };
        const pageNumber = typeof p.pageNumber === "number" ? p.pageNumber : out.length + 1;
        const md = typeof p.markdown === "string" ? p.markdown : typeof p.text === "string" ? p.text : "";
        if (md.trim().length > 0) out.push({ pageNumber, markdown: md });
      }
      if (out.length > 0) return out;
    }
  }
  return [{ pageNumber: 1, markdown: fallbackMarkdown }];
}

function buildIndex(stem: string, pages: PageRecord[]): string {
  const lines = [`# ${stem}`, "", `Pages: ${pages.length}`, ""];
  if (pages.length > 1) {
    lines.push("## Pages");
    for (const page of pages) {
      const padded = String(page.pageNumber).padStart(3, "0");
      lines.push(`- [Page ${page.pageNumber}](pages/page-${padded}.md)`);
    }
    lines.push("");
  }
  lines.push("All pages joined: [all-pages.md](all-pages.md)", "");
  return lines.join("\n");
}

function joinPages(pages: PageRecord[]): string {
  return pages
    .map((page) => `## Page ${page.pageNumber}\n\n${page.markdown.trim()}\n`)
    .join("\n");
}

function sanitizeStem(name: string): string {
  const noExt = name.replace(/\.[^./\\]+$/, "");
  const sansSeparators = noExt.replace(/[\\/:*?"<>|]+/g, "_");
  const sansDoubleDots = sansSeparators.replace(/\.{2,}/g, ".");
  const sansLeadingDots = sansDoubleDots.replace(/^\.+/, "_");
  const safe = sansLeadingDots.trim().slice(0, 200);
  return safe.length > 0 ? safe : "extracto-job";
}
