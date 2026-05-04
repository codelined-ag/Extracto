import { describe, it, expect } from "vitest";

import { detectDegenerate } from "@/lib/ocr/degenerate-detection";
import { computeDegenerateRetryBudget } from "@/lib/ocr/pipeline-page-loop";

describe("detectDegenerate", () => {
  it("returns null for empty input", () => {
    expect(detectDegenerate("")).toBeNull();
  });

  it("returns null for very short input", () => {
    expect(detectDegenerate("Short and sane.")).toBeNull();
  });

  it("returns null for normal prose", () => {
    const text =
      "The quick brown fox jumps over the lazy dog. " +
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " +
      "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
    expect(detectDegenerate(text)).toBeNull();
  });

  it("flags a long single-character run", () => {
    const text =
      "Some leading text here that is long enough to inspect. " +
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa next sentence.";
    expect(detectDegenerate(text)?.reason).toBe("char-run");
  });

  it("flags a long no-whitespace block", () => {
    const blob = "x".repeat(250);
    const text = "Header line here.\n" + blob + "\nFooter line here that is also descriptive.";
    expect(detectDegenerate(text)?.reason).toBe("char-run");
  });

  it("flags a no-whitespace block when the run uses varied chars", () => {
    const text =
      "Some sentence to make the inspector engage. " +
      "abcdefghij".repeat(25) +
      " trailing content here.";
    expect(detectDegenerate(text)?.reason).toBe("no-whitespace");
  });

  it("flags a single-token loop that dominates the page", () => {
    const text =
      "Header sentence to pass the size gate of the detector. " +
      "spam spam spam spam spam spam spam spam spam spam spam spam spam spam spam spam spam spam end.";
    expect(detectDegenerate(text)?.reason).toBe("token-loop");
  });

  it("flags a multi-token loop", () => {
    const text =
      "Header sentence here to exceed the size gate of the detector. " +
      "buy now buy now buy now buy now buy now buy now buy now buy now end of file.";
    expect(detectDegenerate(text)?.reason).toBe("token-loop");
  });

  it("flags provider artifact tokens", () => {
    const text =
      "Page contents that are long enough to trip the inspector window check. " +
      "<|endoftext|> some leftover noise here.";
    expect(detectDegenerate(text)?.reason).toBe("provider-noise");
  });

  it("flags a leftover INST tag", () => {
    const text =
      "Real-looking output that came back from the model and is roughly long enough. " +
      "[INST] something the user said [/INST] more output continues here.";
    expect(detectDegenerate(text)?.reason).toBe("provider-noise");
  });

  it("does NOT flag a structured form with a few legitimate 'n/a' repeats", () => {
    const text =
      "Application Form: legal name, address, prior employment, references. " +
      "Field 1 answer here. Field 2 answer here. Field 3 answer here. " +
      "Optional section: n a n a n a n a n a n a end of optional section.";
    expect(detectDegenerate(text)).toBeNull();
  });

  it("does NOT flag a long currency total without spaces", () => {
    const text =
      "The grand total at the bottom of the receipt reads as one number for accountants. " +
      "USD12345678.90 plus fees, ledger entry follows in the next column over.";
    expect(detectDegenerate(text)).toBeNull();
  });
});

describe("computeDegenerateRetryBudget", () => {
  it("scales with page count, capped at 10", () => {
    expect(computeDegenerateRetryBudget(1)).toBe(1);
    expect(computeDegenerateRetryBudget(4)).toBe(1);
    expect(computeDegenerateRetryBudget(8)).toBe(2);
    expect(computeDegenerateRetryBudget(40)).toBe(10);
    expect(computeDegenerateRetryBudget(200)).toBe(10);
  });
});
