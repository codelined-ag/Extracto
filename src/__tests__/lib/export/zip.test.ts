import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildJobZip } from "@/lib/export/zip";

const MULTI_PAGE_RESULT = {
  structured: {
    pages: [
      { pageNumber: 1, markdown: "# Page 1\n\nFirst page body." },
      { pageNumber: 2, markdown: "# Page 2\n\nSecond page body." },
      { pageNumber: 3, markdown: "# Page 3\n\nThird page body." },
    ],
  },
};

describe("buildJobZip", () => {
  it("includes index.md, all-pages.md, and one md per page", async () => {
    const buf = await buildJobZip({
      fileName: "Invoice.pdf",
      extractedText: "joined text",
      result: MULTI_PAGE_RESULT,
    });
    const zip = await JSZip.loadAsync(buf);
    const paths = Object.keys(zip.files).filter((p) => !p.endsWith("/")).sort();
    expect(paths).toEqual([
      "Invoice/all-pages.md",
      "Invoice/index.md",
      "Invoice/pages/page-001.md",
      "Invoice/pages/page-002.md",
      "Invoice/pages/page-003.md",
    ]);
  });

  it("renders the index with page count and links", async () => {
    const buf = await buildJobZip({
      fileName: "Invoice.pdf",
      extractedText: "x",
      result: MULTI_PAGE_RESULT,
    });
    const zip = await JSZip.loadAsync(buf);
    const index = await zip.files["Invoice/index.md"].async("text");
    expect(index).toContain("Pages: 3");
    expect(index).toContain("[Page 1](pages/page-001.md)");
    expect(index).toContain("[Page 3](pages/page-003.md)");
    expect(index).toContain("[all-pages.md](all-pages.md)");
  });

  it("falls back to a single page from extractedText when no structured pages", async () => {
    const buf = await buildJobZip({
      fileName: "report.pdf",
      extractedText: "# Solo content\n\nbody only.",
      result: undefined,
    });
    const zip = await JSZip.loadAsync(buf);
    const paths = Object.keys(zip.files).filter((p) => !p.endsWith("/")).sort();
    expect(paths).toEqual(["report/all-pages.md", "report/index.md", "report/pages/page-001.md"]);
    const page = await zip.files["report/pages/page-001.md"].async("text");
    expect(page).toContain("Solo content");
  });

  it("sanitizes the file stem", async () => {
    const buf = await buildJobZip({
      fileName: "../../etc/passwd",
      extractedText: "hi",
    });
    const zip = await JSZip.loadAsync(buf);
    const top = Object.keys(zip.files).find((p) => p.endsWith("/index.md"))!;
    expect(top).not.toContain("..");
    expect(top).not.toContain("/etc/");
  });

  it("falls back to extracto-job when filename is missing", async () => {
    const buf = await buildJobZip({ extractedText: "anything" });
    const zip = await JSZip.loadAsync(buf);
    const paths = Object.keys(zip.files).filter((p) => p.endsWith("/index.md"));
    expect(paths[0]).toBe("extracto-job/index.md");
  });

  it("emits a non-empty zip with the correct magic bytes", async () => {
    const buf = await buildJobZip({ fileName: "x.pdf", extractedText: "hello" });
    expect(buf.length).toBeGreaterThan(100);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
