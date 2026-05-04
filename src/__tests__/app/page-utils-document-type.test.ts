import { describe, it, expect } from "vitest";

import { getDocumentType } from "@/app/page-components/page-utils";

describe("getDocumentType", () => {
  it("returns null for non-object metadata", () => {
    expect(getDocumentType(null)).toBeNull();
    expect(getDocumentType(undefined)).toBeNull();
    expect(getDocumentType("string")).toBeNull();
  });

  it("returns null when there is no documentType key", () => {
    expect(getDocumentType({ pageResults: [] })).toBeNull();
  });

  it("returns null for unknown kinds", () => {
    expect(getDocumentType({ documentType: { kind: "memo", confidence: 0.9 } })).toBeNull();
  });

  it("returns null for generic or zero-confidence", () => {
    expect(getDocumentType({ documentType: { kind: "generic", confidence: 0.5 } })).toBeNull();
    expect(getDocumentType({ documentType: { kind: "invoice", confidence: 0 } })).toBeNull();
  });

  it("returns valid classification", () => {
    expect(
      getDocumentType({ documentType: { kind: "invoice", confidence: 0.75 } }),
    ).toEqual({ kind: "invoice", confidence: 0.75 });
  });
});
