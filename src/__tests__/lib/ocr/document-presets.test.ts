import { describe, it, expect } from "vitest";

import {
  applyDocumentPresetToPrompt,
  DOCUMENT_PRESETS,
  getDocumentPreset,
} from "@/lib/ocr/document-presets";

describe("DOCUMENT_PRESETS", () => {
  it("ships generic, academic, invoice, contract, form", () => {
    expect(Object.keys(DOCUMENT_PRESETS).sort()).toEqual([
      "academic",
      "contract",
      "form",
      "generic",
      "invoice",
    ]);
  });

  it("generic preset has no addendum", () => {
    expect(DOCUMENT_PRESETS.generic.promptAddendum).toBe("");
  });

  it("invoice preset advertises a JSON schema hint", () => {
    expect(DOCUMENT_PRESETS.invoice.jsonSchemaHint).toBe("invoice");
  });
});

describe("applyDocumentPresetToPrompt", () => {
  it("returns the base prompt unchanged for generic", () => {
    const r = applyDocumentPresetToPrompt("OCR this", "generic");
    expect(r).toBe("OCR this");
  });

  it("prepends an addendum for academic", () => {
    const r = applyDocumentPresetToPrompt("OCR this", "academic");
    expect(r).toContain("DOCUMENT TYPE: Academic paper");
    expect(r).toContain("scholarly paper");
    expect(r).toContain("OCR this");
    expect(r.indexOf("OCR this")).toBeGreaterThan(r.indexOf("DOCUMENT TYPE"));
  });

  it("invoice preset enforces JSON schema language", () => {
    const r = applyDocumentPresetToPrompt("base", "invoice");
    expect(r).toContain("invoiceNumber");
    expect(r).toContain("lineItems");
  });
});

describe("getDocumentPreset", () => {
  it("returns the requested preset", () => {
    expect(getDocumentPreset("contract").id).toBe("contract");
  });

  it("falls back to generic for invalid kind (typescript escape)", () => {
    // @ts-expect-error - intentionally bad input
    expect(getDocumentPreset("nonexistent").id).toBe("generic");
  });
});
