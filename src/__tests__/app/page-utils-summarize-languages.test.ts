import { describe, it, expect } from "vitest";

import { summarizeDetectedLanguages } from "@/app/page-components/page-utils";

describe("summarizeDetectedLanguages", () => {
  it("returns empty arrays when there is no structured payload", () => {
    expect(summarizeDetectedLanguages(undefined)).toEqual({ codes: [], names: [] });
    expect(summarizeDetectedLanguages(null)).toEqual({ codes: [], names: [] });
    expect(summarizeDetectedLanguages({})).toEqual({ codes: [], names: [] });
  });

  it("extracts unique language codes and names from pages", () => {
    const result = summarizeDetectedLanguages({
      pages: [
        { pageNumber: 1, language: "eng", languageName: "English" },
        { pageNumber: 2, language: "ita", languageName: "Italian" },
        { pageNumber: 3, language: "eng", languageName: "English" },
      ],
    });
    expect(result.codes).toEqual(["eng", "ita"]);
    expect(result.names).toEqual(["English", "Italian"]);
  });

  it("ignores entries without language fields", () => {
    const result = summarizeDetectedLanguages({
      pages: [
        { pageNumber: 1 },
        { pageNumber: 2, language: "fra" },
      ],
    });
    expect(result.codes).toEqual(["fra"]);
    expect(result.names).toEqual([]);
  });
});
