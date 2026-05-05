import { describe, expect, it } from "vitest";

import { isClientOnline, isNetworkError } from "@/lib/offline/network-status";

describe("isClientOnline", () => {
  it("defaults to online when navigator is missing", () => {
    expect(isClientOnline()).toBe(true);
  });
});

describe("isNetworkError", () => {
  it("treats TypeError as a network failure", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("treats Error with a network-shaped message as a network failure", () => {
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
  });

  it("does not treat AbortError as a network failure", () => {
    const abort = new DOMException("aborted", "AbortError");
    expect(isNetworkError(abort)).toBe(false);
  });

  it("ignores plain Errors with unrelated messages", () => {
    expect(isNetworkError(new Error("OCR job not found"))).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});
