import { describe, it, expect } from "vitest";

import { extractDocumentMetadata } from "@/lib/ocr/document-metadata";

describe("extractDocumentMetadata", () => {
  it("returns an empty object for empty input", () => {
    expect(extractDocumentMetadata("")).toEqual({});
  });

  it("picks the first non-empty heading-like line as the title", () => {
    const text = "\n\n# Quarterly Earnings Report\n\nFiled with the SEC on May 4 2026.";
    const meta = extractDocumentMetadata(text);
    expect(meta.title).toBe("Quarterly Earnings Report");
  });

  it("strips markdown # markers and ignores page-number-only lines", () => {
    const text = "1\n\nPage 1\n\n## Annual report 2026";
    expect(extractDocumentMetadata(text).title).toBe("Annual report 2026");
  });

  it("extracts an ISO 8601 date", () => {
    const text = "Filed on 2026-03-15 by the office of compliance.";
    expect(extractDocumentMetadata(text).date).toBe("2026-03-15");
  });

  it("extracts a long-form English date", () => {
    const text = "Memorandum, dated 14 March 2026, regarding budgets.";
    expect(extractDocumentMetadata(text).date).toBe("14 March 2026");
  });

  it("extracts month-first English date with comma", () => {
    const text = "Released March 14, 2026 to all employees.";
    expect(extractDocumentMetadata(text).date).toBe("March 14, 2026");
  });

  it("extracts authors from a By/Author line", () => {
    const text = "Working Paper\nAuthor: Jane Doe, John Smith and Alex Lee\nAbstract...";
    const meta = extractDocumentMetadata(text);
    expect(meta.authors).toEqual(["Jane Doe", "John Smith", "Alex Lee"]);
  });

  it("falls back to no authors when no pattern matches", () => {
    const text = "Random body text without an author line.";
    expect(extractDocumentMetadata(text).authors).toBeUndefined();
  });

  it("returns top frequent non-stopword keywords from the first page", () => {
    const text =
      "Compliance audit compliance compliance compliance " +
      "report report report report " +
      "annual annual annual annual " +
      "the the the the the and and and and and " +
      "operations operations operations " +
      "directors directors directors directors";
    const meta = extractDocumentMetadata(text);
    expect(meta.keywords).toBeDefined();
    expect(meta.keywords).toContain("compliance");
    expect(meta.keywords).toContain("annual");
    expect(meta.keywords).toContain("report");
    expect(meta.keywords).not.toContain("the");
    expect(meta.keywords).not.toContain("and");
  });

  it("skips keywords if there's not enough text", () => {
    const text = "Hi.";
    expect(extractDocumentMetadata(text).keywords).toBeUndefined();
  });

  it("skips keywords for non-English languages (English stopword list would yield noise)", () => {
    const text =
      "alla che dei della delle dei degli alla le che alla che dei della delle dei degli alla le che";
    expect(extractDocumentMetadata(text, "ita").keywords).toBeUndefined();
  });

  it("emits keywords when language is undetermined or English", () => {
    const text =
      "Compliance audit compliance compliance compliance compliance compliance " +
      "report report report report report report report report " +
      "annual annual annual annual annual annual " +
      "directors directors directors directors directors directors directors " +
      "operations operations operations operations operations";
    expect(extractDocumentMetadata(text, "eng").keywords).toBeDefined();
    expect(extractDocumentMetadata(text, "und").keywords).toBeDefined();
    expect(extractDocumentMetadata(text).keywords).toBeDefined();
  });
});
