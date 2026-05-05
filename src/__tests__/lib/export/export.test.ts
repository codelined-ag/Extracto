import { describe, expect, it } from "vitest";

import { markdownToCsv } from "@/lib/export/csv";
import { markdownToDocx } from "@/lib/export/docx";
import { markdownToRtf } from "@/lib/export/rtf";
import { markdownToXlsx } from "@/lib/export/xlsx";
import { extractTables } from "@/lib/export/tables";
import {
  ExportTooLargeError,
  MAX_EXPORT_INPUT_BYTES,
  renderJobExport,
} from "@/lib/export";
import { markdownToHtml } from "@/lib/export/html";

const SAMPLE_TABLE_MD = `# Invoice

Vendor: ACME

| SKU | Qty | Price |
|-----|-----|-------|
| A1  | 2   | 9.99  |
| B2  | 1   | 12.50 |

Total: 32.48
`;

describe("extractTables", () => {
  it("returns one table from a single-table markdown", () => {
    const tables = extractTables(SAMPLE_TABLE_MD);
    expect(tables).toHaveLength(1);
    expect(tables[0].header).toEqual(["SKU", "Qty", "Price"]);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]).toEqual(["A1", "2", "9.99"]);
  });

  it("returns no tables for plain prose", () => {
    expect(extractTables("# Just text\n\nNo tables here.")).toHaveLength(0);
  });
});

describe("markdownToCsv", () => {
  it("emits the table as CSV with a header row, BOM, and CRLF", () => {
    const csv = markdownToCsv(SAMPLE_TABLE_MD);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const headerLine = csv.slice(1).split("\r\n")[0];
    expect(headerLine).toBe("SKU,Qty,Price");
    expect(csv).toContain("A1,2,9.99\r\nB2,1,12.50");
  });

  it("quotes fields containing commas", () => {
    const md = `| name | note |\n|------|------|\n| smith | hello, world |\n`;
    const csv = markdownToCsv(md);
    expect(csv).toContain('smith,"hello, world"');
  });

  it("escapes embedded double quotes", () => {
    const md = `| col |\n|-----|\n| she said "hi" |\n`;
    const csv = markdownToCsv(md);
    expect(csv).toContain('"she said ""hi"""');
  });

  it("falls back to a one-column dump for prose with no tables", () => {
    const csv = markdownToCsv("first\nsecond\nthird");
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("text");
    expect(lines).toContain("first");
    expect(lines).toContain("third");
  });
});

describe("markdownToRtf", () => {
  it("emits a valid RTF preamble", () => {
    const rtf = markdownToRtf("# Title\n\nHello.");
    expect(rtf).toMatch(/^\{\\rtf1/);
    expect(rtf).toContain("Title");
    expect(rtf).toContain("Hello.");
    expect(rtf.endsWith("}")).toBe(true);
  });

  it("escapes braces and backslashes", () => {
    const rtf = markdownToRtf("a {b} c \\d");
    expect(rtf).toContain("\\{b\\}");
    expect(rtf).toContain("\\\\d");
  });

  it("encodes non-ASCII characters as unicode escapes", () => {
    const rtf = markdownToRtf("Café");
    expect(rtf).toMatch(/\\u\d+\?/);
  });

  it("emits a table with row markers", () => {
    const rtf = markdownToRtf(SAMPLE_TABLE_MD);
    expect(rtf).toContain("\\trowd");
    expect(rtf).toContain("\\cell");
    expect(rtf).toContain("SKU");
  });
});

describe("markdownToDocx", () => {
  it("returns a non-empty buffer with the DOCX magic header", async () => {
    const buf = await markdownToDocx("# Title\n\nHello body.");
    expect(buf.length).toBeGreaterThan(500);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});

describe("markdownToXlsx", () => {
  it("returns a non-empty buffer with the XLSX magic header for a tabled doc", async () => {
    const buf = await markdownToXlsx(SAMPLE_TABLE_MD);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("still emits a workbook for prose without tables (text dump sheet)", async () => {
    const buf = await markdownToXlsx("just words here");
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe("markdownToHtml", () => {
  it("renders headings, paragraphs, and tables as real HTML", () => {
    const html = markdownToHtml(SAMPLE_TABLE_MD);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>Invoice</h1>");
    expect(html).toMatch(/<table>[\s\S]*<th>SKU<\/th>[\s\S]*<td>A1<\/td>/);
    expect(html).toContain("</body></html>");
  });

  it("escapes script tags in markdown text", () => {
    const html = markdownToHtml('Hello <script>alert("xss")</script>');
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("preserves nested formatting", () => {
    const html = markdownToHtml("**bold *and italic* mix**");
    expect(html).toMatch(/<strong>[\s\S]*<em>and italic<\/em>[\s\S]*<\/strong>/);
  });
});

describe("renderJobExport", () => {
  it("returns md as utf-8 with the right content type", async () => {
    const r = await renderJobExport("md", { fileName: "test.pdf", extractedText: "# x", result: {} });
    expect(r.filename).toBe("test.md");
    expect(r.contentType).toMatch(/markdown/);
    expect(r.body.toString("utf-8")).toBe("# x");
  });

  it("strips the file extension before adding the new one", async () => {
    const r = await renderJobExport("docx", { fileName: "Invoice.pdf", extractedText: "# x", result: {} });
    expect(r.filename).toBe("Invoice.docx");
  });

  it("falls back to extracto-job when fileName is missing", async () => {
    const r = await renderJobExport("csv", { extractedText: "a", result: {} });
    expect(r.filename).toBe("extracto-job.csv");
  });

  it("sanitizes path separators and reserved characters", async () => {
    const r = await renderJobExport("rtf", { fileName: "../../etc/passwd", extractedText: "hi", result: {} });
    expect(r.filename).not.toContain("..");
    expect(r.filename).not.toContain("/");
    expect(r.filename.endsWith(".rtf")).toBe(true);
  });

  it("rejects sources larger than MAX_EXPORT_INPUT_BYTES with ExportTooLargeError", async () => {
    const huge = "a".repeat(MAX_EXPORT_INPUT_BYTES + 1);
    await expect(
      renderJobExport("md", { fileName: "x.pdf", extractedText: huge, result: {} }),
    ).rejects.toBeInstanceOf(ExportTooLargeError);
  });

  it("emits txt without markdown sigils", async () => {
    const r = await renderJobExport("txt", {
      fileName: "x.pdf",
      extractedText: "# Title\n\n**bold** and *italic*",
      result: {},
    });
    const text = r.body.toString("utf-8");
    expect(text).not.toContain("**");
    expect(text).not.toContain("# ");
    expect(text).toContain("bold");
  });
});
