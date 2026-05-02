import { describe, it, expect } from "vitest";
import {
  getStringField,
  parsePreviewImageData,
  parseServiceError,
} from "@/lib/ocr/error-parsing";

describe("getStringField", () => {
  it("returns the string value when key exists and is a string", () => {
    expect(getStringField({ message: "hello" }, "message")).toBe("hello");
  });

  it("returns null when key is missing", () => {
    expect(getStringField({ other: "x" }, "message")).toBe(null);
  });

  it("returns null when value is not a string", () => {
    expect(getStringField({ message: 42 }, "message")).toBe(null);
    expect(getStringField({ message: true }, "message")).toBe(null);
    expect(getStringField({ message: null }, "message")).toBe(null);
    expect(getStringField({ message: { nested: "x" } }, "message")).toBe(null);
  });

  it("returns null for non-object inputs", () => {
    expect(getStringField(null, "message")).toBe(null);
    expect(getStringField(undefined, "message")).toBe(null);
    expect(getStringField("string", "message")).toBe(null);
    expect(getStringField(42, "message")).toBe(null);
  });

  it("returns empty string when value is an empty string", () => {
    expect(getStringField({ message: "" }, "message")).toBe("");
  });
});

describe("parseServiceError", () => {
  const mkResponse = (statusText: string) => ({ statusText });

  it("extracts message from { error: { message: '...' } }", () => {
    expect(
      parseServiceError(mkResponse("Bad Request"), {
        error: { message: "specific failure" },
      })
    ).toBe("specific failure");
  });

  it("extracts detail when message is missing on nested error", () => {
    expect(
      parseServiceError(mkResponse("Bad Request"), {
        error: { detail: "detailed reason" },
      })
    ).toBe("detailed reason");
  });

  it("extracts first errors[] entry when neither message nor detail exists", () => {
    expect(
      parseServiceError(mkResponse("Bad Request"), {
        error: { errors: ["first error", "second error"] },
      })
    ).toBe("first error");
  });

  it("extracts flat error string when error is a string field", () => {
    expect(
      parseServiceError(mkResponse("Bad Request"), { error: "flat error string" })
    ).toBe("flat error string");
  });

  it("falls back to top-level message", () => {
    expect(
      parseServiceError(mkResponse("Bad Request"), { message: "top message" })
    ).toBe("top message");
  });

  it("falls back to top-level detail", () => {
    expect(
      parseServiceError(mkResponse("Bad Request"), { detail: "top detail" })
    ).toBe("top detail");
  });

  it("falls back to response.statusText when no payload field matches", () => {
    expect(parseServiceError(mkResponse("Internal Server Error"), {})).toBe(
      "Internal Server Error"
    );
  });

  it("falls back to 'Request failed' when statusText is empty and no payload", () => {
    expect(parseServiceError(mkResponse(""), {})).toBe("Request failed");
  });

  it("handles null payload", () => {
    expect(parseServiceError(mkResponse("Not Found"), null)).toBe("Not Found");
  });

  it("handles undefined payload", () => {
    expect(parseServiceError(mkResponse("Not Found"), undefined)).toBe("Not Found");
  });

  it("nested error.message wins over top-level message", () => {
    expect(
      parseServiceError(mkResponse("X"), {
        error: { message: "nested win" },
        message: "top loses",
      })
    ).toBe("nested win");
  });

  it("ignores empty errors[]", () => {
    expect(
      parseServiceError(mkResponse("Status"), {
        error: { errors: [] },
        message: "fallback message",
      })
    ).toBe("fallback message");
  });

  it("ignores non-string first entry in errors[]", () => {
    expect(
      parseServiceError(mkResponse("Status"), {
        error: { errors: [{ obj: true }, "second"] },
        message: "fallback message",
      })
    ).toBe("fallback message");
  });
});

describe("parsePreviewImageData", () => {
  it("returns empty payload for empty preview", () => {
    expect(parsePreviewImageData("")).toEqual({
      mimeType: "image/jpeg",
      base64: "",
      dataUrl: "",
    });
  });

  it("parses canonical data URL with explicit mime type and base64", () => {
    const result = parsePreviewImageData("data:image/png;base64,iVBORw0KG");
    expect(result.mimeType).toBe("image/png");
    expect(result.base64).toBe("iVBORw0KG");
    expect(result.dataUrl).toBe("data:image/png;base64,iVBORw0KG");
  });

  it("defaults to image/jpeg when mime type is unparseable on canonical pattern", () => {
    // The pattern requires a non-empty mime — empty mime falls through to the
    // second branch, so test the second-branch fallback.
    const result = parsePreviewImageData("data:,plain-content");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.base64).toBe("plain-content");
  });

  it("parses non-base64 data URL via second branch (no ;base64)", () => {
    const result = parsePreviewImageData("data:image/svg+xml,%3Csvg%2F%3E");
    expect(result.mimeType).toBe("image/svg+xml");
    expect(result.base64).toBe("%3Csvg%2F%3E");
    expect(result.dataUrl).toBe("data:image/svg+xml;base64,%3Csvg%2F%3E");
  });

  it("treats raw base64 (no data: prefix) as image/jpeg", () => {
    const result = parsePreviewImageData("iVBORw0KGgoAAAA");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.base64).toBe("iVBORw0KGgoAAAA");
    expect(result.dataUrl).toBe("data:image/jpeg;base64,iVBORw0KGgoAAAA");
  });

  it("trims whitespace on raw base64 input", () => {
    const result = parsePreviewImageData("  abcDEF  ");
    expect(result.base64).toBe("abcDEF");
  });

  it("preserves long base64 strings unchanged", () => {
    const long = "A".repeat(1000);
    const result = parsePreviewImageData(`data:image/png;base64,${long}`);
    expect(result.base64).toBe(long);
  });

  it("trims surrounding whitespace from mime type", () => {
    const result = parsePreviewImageData("data: image/png ;base64,abc");
    expect(result.mimeType).toBe("image/png");
  });
});
