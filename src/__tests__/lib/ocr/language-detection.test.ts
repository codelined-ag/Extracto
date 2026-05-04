import { describe, expect, it } from "vitest";

import { detectPageLanguage } from "@/lib/ocr/language-detection";

describe("detectPageLanguage", () => {
  it("returns null for empty input", () => {
    expect(detectPageLanguage("")).toBeNull();
  });

  it("returns null for very short text below the minimum", () => {
    expect(detectPageLanguage("Hi.")).toBeNull();
  });

  it("identifies English for a standard paragraph", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. This is a sentence in English used as a sample.";
    const detected = detectPageLanguage(text);
    expect(detected).not.toBeNull();
    expect(detected?.iso6393).toBe("eng");
    expect(detected?.name).toBe("English");
  });

  it("identifies Italian for an Italian paragraph", () => {
    const text =
      "Questo è un paragrafo in italiano. La lingua italiana è una lingua romanza parlata principalmente in Italia.";
    const detected = detectPageLanguage(text);
    expect(detected?.iso6393).toBe("ita");
    expect(detected?.name).toBe("Italian");
  });

  it("collapses whitespace runs before measuring length", () => {
    const text = "Hi.\n\n\n\n\n\n\n\n";
    expect(detectPageLanguage(text)).toBeNull();
  });

  it("returns null for digits-only / numeric-table content", () => {
    const text =
      "12.45 67.89 3.14 99.00 100.00 250.00 9999 5,000.00 1,234.56 0.99 42";
    expect(detectPageLanguage(text)).toBeNull();
  });

  it("returns null for URL-only content", () => {
    const text =
      "https://example.com/path/one https://example.com/path/two https://example.com/path/three";
    expect(detectPageLanguage(text)).toBeNull();
  });
});
