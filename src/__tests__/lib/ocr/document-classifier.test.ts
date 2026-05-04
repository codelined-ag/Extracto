import { describe, it, expect } from "vitest";

import { classifyDocumentType } from "@/lib/ocr/document-classifier";

describe("classifyDocumentType", () => {
  it("returns generic+0 for empty input", () => {
    expect(classifyDocumentType("")).toEqual({ kind: "generic", confidence: 0 });
  });

  it("returns generic+0 for very short input", () => {
    expect(classifyDocumentType("Just a tiny note.")).toEqual({ kind: "generic", confidence: 0 });
  });

  it("classifies an invoice header", () => {
    const text =
      "Invoice No. 2026-04501\nBill to: ACME Corp\nVAT number: IT12345\nSubtotal: 1,200\nTax ID: ABCDEF\nNet 30 days payment terms.\nDate of issue: 2026-04-15.";
    const result = classifyDocumentType(text);
    expect(result.kind).toBe("invoice");
    expect(result.confidence).toBeGreaterThan(0.25);
  });

  it("classifies a contract", () => {
    const text =
      "This Agreement is entered into between PartyA Inc and PartyB LLC. " +
      "WHEREAS the parties hereby agree on the following terms. " +
      "Effective Date: 2026-01-01. " +
      "Governing Law: State of Delaware. " +
      "Non-disclosure obligations apply.";
    expect(classifyDocumentType(text).kind).toBe("contract");
  });

  it("classifies an academic paper", () => {
    const text =
      "Abstract: This paper investigates the foundations of distributed consensus.\n" +
      "DOI: 10.1234/example.5678\n" +
      "References\n" +
      "1. Smith et al, 2025. arXiv:2503.01234.\n" +
      "ISBN 978-0-12-345678-9 cited as a foundational text.";
    expect(classifyDocumentType(text).kind).toBe("academic");
  });

  it("classifies a receipt", () => {
    const text =
      "Receipt #4567\nCashier: 003\nVisa **** 1234 — Auth code 123456\nTendered: 50.00\nChange due: 2.45\nThank you for your purchase.";
    expect(classifyDocumentType(text).kind).toBe("receipt");
  });

  it("classifies an ID document", () => {
    const text =
      "PASSPORT\nPassport No.: AB1234567\nDate of Birth: 1990-05-12\nPlace of Birth: Rome\nNationality: ITA\nIssuing Authority: Ministero degli Esteri\nSex: M";
    expect(classifyDocumentType(text).kind).toBe("id");
  });

  it("classifies a form", () => {
    const text =
      "Application Form No. 4521\nPlease fill in all sections in block letters.\nApplicant's name: ____________\nCheck all that apply: [ ] Option A [ ] Option B\nSection 2 of 4\nSignature: __________";
    expect(classifyDocumentType(text).kind).toBe("form");
  });

  it("returns generic when nothing matches", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.";
    expect(classifyDocumentType(text)).toEqual({ kind: "generic", confidence: 0 });
  });

  it("does not classify generic prose containing the word 'sex' as an ID document", () => {
    const text =
      "The article discusses sex of the participants and sex Mister Jones reports as part of the cohort study. " +
      "The findings cover demographics across age and sex of the survey group. " +
      "Further details about the cohort follow.";
    expect(classifyDocumentType(text).kind).not.toBe("id");
  });

  it("does not classify generic prose containing 'signature' as a form", () => {
    const text =
      "The author's signature style is described in the introduction. " +
      "Their signature appears in printed publications across the decades. " +
      "Critics note the signature aesthetic in every chapter.";
    expect(classifyDocumentType(text).kind).not.toBe("form");
  });
});
