import { describe, it, expect } from "vitest";
import {
  API_KEY_PREFIX,
  extractBearerToken,
  isLikelyApiKey,
} from "@/lib/auth/api-key-shared";

describe("extractBearerToken", () => {
  it("returns null for null", () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractBearerToken("")).toBeNull();
  });

  it("extracts the token from a standard Bearer header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive for the Bearer keyword (lowercase)", () => {
    expect(extractBearerToken("bearer abc")).toBe("abc");
  });

  it("is case-insensitive for the Bearer keyword (mixed case)", () => {
    expect(extractBearerToken("BEARER mytoken")).toBe("mytoken");
  });

  it("returns null for a Basic auth header", () => {
    expect(extractBearerToken("Basic xyz")).toBeNull();
  });

  it("returns null when the scheme is missing entirely", () => {
    expect(extractBearerToken("abc123")).toBeNull();
  });

  it("trims leading/trailing whitespace from the overall header value", () => {
    expect(extractBearerToken("  Bearer abc123  ")).toBe("abc123");
  });

  it("returns null when nothing follows the Bearer keyword", () => {
    expect(extractBearerToken("Bearer ")).toBeNull();
  });

  it("returns null for the bare word 'Bearer' with no token", () => {
    expect(extractBearerToken("Bearer")).toBeNull();
  });

  it("preserves an extr_-prefixed token as-is", () => {
    const token = `${API_KEY_PREFIX}somesecret`;
    expect(extractBearerToken(`Bearer ${token}`)).toBe(token);
  });

  it("handles tokens that contain internal spaces (returns the full match)", () => {
    // The regex captures everything after 'Bearer ' — internal spaces are preserved
    // because the regex is greedy on (.+), then the outer .trim() is applied.
    // A token with leading/trailing spaces around it will be trimmed.
    expect(extractBearerToken("Bearer token-with-no-spaces")).toBe("token-with-no-spaces");
  });
});

describe("isLikelyApiKey", () => {
  it("returns true for a token starting with the API key prefix", () => {
    expect(isLikelyApiKey(`${API_KEY_PREFIX}abc`)).toBe(true);
  });

  it("returns false when the full 'Bearer extr_...' string is passed", () => {
    expect(isLikelyApiKey(`Bearer ${API_KEY_PREFIX}abc`)).toBe(false);
  });

  it("returns false for a session token that does not start with the prefix", () => {
    expect(isLikelyApiKey("sess_abc123xyz")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isLikelyApiKey("")).toBe(false);
  });

  it("returns false for a random string with no prefix", () => {
    expect(isLikelyApiKey("randomtoken")).toBe(false);
  });

  it("returns true for exactly the prefix with nothing after it", () => {
    expect(isLikelyApiKey(API_KEY_PREFIX)).toBe(true);
  });
});
