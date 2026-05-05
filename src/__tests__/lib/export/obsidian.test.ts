import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildObsidianVaultZip, obsidianFilename } from "@/lib/export/obsidian";

const SINGLE_PAGE_MD = "# Hello\n\nA single-page document.\n";

const MULTI_PAGE_RESULT = {
  structured: {
    pages: [
      { pageNumber: 1, markdown: "# Page 1\n\nFirst page content." },
      { pageNumber: 2, markdown: "# Page 2\n\nSecond page content." },
    ],
  },
};

describe("obsidianFilename", () => {
  it("strips reserved Obsidian filename chars", () => {
    expect(obsidianFilename("a/b\\c:d#e^f|g?h*i<j>k\"l[m]n.pdf")).not.toMatch(/[\\/:#^|?*<>"\[\]]/);
  });

  it("collapses whitespace from sanitization", () => {
    expect(obsidianFilename("a / b / c.pdf")).toBe("a b c");
  });

  it("escapes a leading dot to underscore", () => {
    expect(obsidianFilename(".hidden.pdf")).toMatch(/^_/);
  });

  it("falls back when nothing remains after sanitization", () => {
    expect(obsidianFilename("////.pdf")).toBe("Extracto job");
  });

  it("caps base length at 240 chars", () => {
    const long = "a".repeat(500) + ".pdf";
    expect(obsidianFilename(long).length).toBe(240);
  });

  it("collapses sequences of dots so .. traversal segments cannot survive", () => {
    expect(obsidianFilename("../../etc/passwd")).not.toContain("..");
    expect(obsidianFilename("foo..bar")).not.toContain("..");
  });
});

describe("buildObsidianVaultZip — yaml safety", () => {
  it("quotes job-id values that contain YAML special characters", async () => {
    const zipBytes = await buildObsidianVaultZip({
      jobId: "job-with: colon",
      fileName: "x.pdf",
      provider: "mistral",
      model: "x",
      createdAt: new Date("2026-05-05T00:00:00Z"),
      extractedText: "body",
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const note = await zip.files[
      Object.keys(zip.files).find((p) => /\bx\.md$/.test(p)) as string
    ].async("text");
    expect(note).toMatch(/ocr-job-id:\s*"job-with: colon"/);
  });

  it("sanitizes provider/model before emitting them to YAML", async () => {
    const zipBytes = await buildObsidianVaultZip({
      jobId: "j",
      fileName: "x.pdf",
      provider: "self-hosted: vllm",
      model: "qwen-2.5: chat",
      createdAt: new Date("2026-05-05T00:00:00Z"),
      extractedText: "body",
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const note = await zip.files[
      Object.keys(zip.files).find((p) => /\bx\.md$/.test(p)) as string
    ].async("text");
    expect(note).not.toMatch(/ocr-provider:.*:.*$/m);
    expect(note).not.toMatch(/ocr-model:.*:.*$/m);
  });
});

describe("buildObsidianVaultZip — single-page", () => {
  it("emits a folder with one note and proper frontmatter", async () => {
    const zipBytes = await buildObsidianVaultZip({
      jobId: "job_abc",
      fileName: "Invoice.pdf",
      provider: "mistral",
      model: "mistral-ocr-latest",
      createdAt: new Date("2026-05-05T14:32:11Z"),
      extractedText: SINGLE_PAGE_MD,
      result: { extractedText: SINGLE_PAGE_MD },
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const noteEntry = Object.keys(zip.files).find((p) => /\bInvoice\.md$/.test(p));
    expect(noteEntry).toBeDefined();
    if (!noteEntry) return;
    const text = await zip.files[noteEntry].async("text");
    expect(text).toMatch(/^---\n/);
    expect(text).toContain("aliases:");
    expect(text).toContain('  - "Invoice.pdf"');
    expect(text).toContain("tags:");
    expect(text).toContain("  - ocr/imported");
    expect(text).toContain("  - provider/mistral");
    expect(text).toContain("ocr-job-id: job_abc");
    expect(text).toContain("pages: 1");
    expect(text).toMatch(/# Hello/);
  });

  it("injects a # Title heading when the body has no H1 of its own", async () => {
    const zipBytes = await buildObsidianVaultZip({
      jobId: "j",
      fileName: "Plain.pdf",
      provider: "mistral",
      model: "x",
      createdAt: "2026-05-05T00:00:00Z",
      extractedText: "no heading here, just prose.",
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const noteEntry = Object.keys(zip.files).find((p) => /Plain\.md$/.test(p));
    expect(noteEntry).toBeDefined();
    if (!noteEntry) return;
    const text = await zip.files[noteEntry].async("text");
    expect(text).toContain("# Plain");
  });

  it("does not emit a pages/ subfolder for single-page jobs", async () => {
    const zipBytes = await buildObsidianVaultZip({
      jobId: "job1",
      fileName: "Receipt.pdf",
      provider: "mistral",
      model: "x",
      createdAt: "2026-05-05T00:00:00Z",
      extractedText: SINGLE_PAGE_MD,
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const hasPages = Object.keys(zip.files).some((p) => /\/pages\//.test(p));
    expect(hasPages).toBe(false);
  });
});

describe("buildObsidianVaultZip — multi-page", () => {
  it("emits an index note plus one note per page in pages/", async () => {
    const zipBytes = await buildObsidianVaultZip({
      jobId: "job_xyz",
      fileName: "Contract.pdf",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      createdAt: "2026-05-05T00:00:00Z",
      extractedText: "# Contract\n\nfull text.",
      result: MULTI_PAGE_RESULT,
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const paths = Object.keys(zip.files).sort();
    const indexPath = paths.find((p) => /\bContract\.md$/.test(p) && !p.includes("/pages/"));
    const pagePaths = paths.filter((p) => p.includes("/pages/") && !p.endsWith("/"));
    expect(indexPath).toBeDefined();
    expect(pagePaths).toHaveLength(2);
    expect(pagePaths.every((p) => p.endsWith(".md"))).toBe(true);
    if (indexPath) {
      const indexText = await zip.files[indexPath].async("text");
      expect(indexText).toContain("## Pages");
      expect(indexText).toContain("[[pages/Contract - Page 01|Page 1]]");
      expect(indexText).toContain("[[pages/Contract - Page 02|Page 2]]");
      expect(indexText).toContain("pages: 2");
    }
  });
});

describe("buildObsidianVaultZip — attachments", () => {
  it("includes a base64 image source under attachments/", async () => {
    const onePixelPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg==";
    const zipBytes = await buildObsidianVaultZip({
      jobId: "j",
      fileName: "scan.png",
      provider: "mistral",
      model: "x",
      createdAt: new Date("2026-05-05T00:00:00Z"),
      extractedText: "text",
      sourcePreview: onePixelPng,
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const attachments = Object.keys(zip.files).filter((p) => p.includes("/attachments/") && !p.endsWith("/"));
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatch(/\.png$/);
  });

  it("does not include attachments when sourcePreview is missing or empty", async () => {
    const zipBytes = await buildObsidianVaultZip({
      jobId: "j",
      fileName: "scan.pdf",
      provider: "mistral",
      model: "x",
      createdAt: new Date("2026-05-05T00:00:00Z"),
      extractedText: "text",
      sourcePreview: null,
    });
    const zip = await JSZip.loadAsync(zipBytes);
    const attachments = Object.keys(zip.files).filter((p) => p.includes("/attachments/") && !p.endsWith("/"));
    expect(attachments).toHaveLength(0);
  });
});
