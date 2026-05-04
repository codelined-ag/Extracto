import { describe, it, expect } from "vitest";

import { getDocumentMetadata } from "@/app/page-components/page-utils";

describe("getDocumentMetadata", () => {
  it("returns null for non-object metadata", () => {
    expect(getDocumentMetadata(null)).toBeNull();
    expect(getDocumentMetadata(undefined)).toBeNull();
    expect(getDocumentMetadata("string")).toBeNull();
    expect(getDocumentMetadata([1, 2, 3])).toBeNull();
  });

  it("returns null when metadata has no document key", () => {
    expect(getDocumentMetadata({ pageResults: [] })).toBeNull();
  });

  it("extracts a partial document object", () => {
    expect(getDocumentMetadata({ document: { title: "Q1 Report" } })).toEqual({
      title: "Q1 Report",
    });
  });

  it("filters out non-string entries from authors and keywords", () => {
    expect(
      getDocumentMetadata({
        document: { authors: ["Alice", 42, "", "Bob"], keywords: ["x", null, "y"] },
      }),
    ).toEqual({ authors: ["Alice", "Bob"], keywords: ["x", "y"] });
  });

  it("returns null when document object is empty", () => {
    expect(getDocumentMetadata({ document: {} })).toBeNull();
  });
});
