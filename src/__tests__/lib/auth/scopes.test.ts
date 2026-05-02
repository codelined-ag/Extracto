import { describe, it, expect } from "vitest";
import {
  ALL_SCOPES,
  WILDCARD_SCOPE,
  parseScopeList,
  serializeScopeList,
  normalizeRequestedScopes,
  scopeListGrants,
} from "@/lib/auth/scopes";

describe("parseScopeList", () => {
  it("parses a JSON string array into an array of strings", () => {
    const result = parseScopeList(JSON.stringify(["ocr:submit", "ocr:read"]));
    expect(result).toEqual(["ocr:submit", "ocr:read"]);
  });

  it("returns [] for a JSON string that is not an array", () => {
    expect(parseScopeList('"ocr:submit"')).toEqual([]);
    expect(parseScopeList('{"key":"value"}')).toEqual([]);
    expect(parseScopeList("42")).toEqual([]);
  });

  it("returns [] for invalid JSON string", () => {
    expect(parseScopeList("not-json")).toEqual([]);
    expect(parseScopeList("{broken}")).toEqual([]);
  });

  it("returns filtered strings when given an actual array", () => {
    expect(parseScopeList(["ocr:submit", "ocr:read"])).toEqual(["ocr:submit", "ocr:read"]);
  });

  it("skips non-string entries in an actual array", () => {
    expect(parseScopeList(["ocr:submit", 42, null, true, "ocr:read"])).toEqual([
      "ocr:submit",
      "ocr:read",
    ]);
  });

  it("skips non-string entries in a JSON string array", () => {
    expect(parseScopeList(JSON.stringify(["ocr:submit", 99, null, "ocr:read"]))).toEqual([
      "ocr:submit",
      "ocr:read",
    ]);
  });

  it("returns [] for null", () => {
    expect(parseScopeList(null)).toEqual([]);
  });

  it("returns [] for a number", () => {
    expect(parseScopeList(42)).toEqual([]);
  });

  it("returns [] for undefined", () => {
    expect(parseScopeList(undefined)).toEqual([]);
  });

  it("returns [] for a plain object", () => {
    expect(parseScopeList({ key: "value" })).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(parseScopeList("")).toEqual([]);
  });
});

describe("serializeScopeList", () => {
  it("round-trips through parseScopeList", () => {
    const scopes = ["ocr:submit", "settings:read", "webhooks:write"];
    const serialized = serializeScopeList(scopes);
    expect(parseScopeList(serialized)).toEqual(scopes);
  });

  it("produces a valid JSON string", () => {
    const scopes = ["ocr:submit", "ocr:read"];
    expect(() => JSON.parse(serializeScopeList(scopes))).not.toThrow();
  });

  it("round-trips an empty array", () => {
    expect(parseScopeList(serializeScopeList([]))).toEqual([]);
  });
});

describe("normalizeRequestedScopes", () => {
  it("returns [WILDCARD_SCOPE] when wildcard is present", () => {
    expect(normalizeRequestedScopes(["*"])).toEqual([WILDCARD_SCOPE]);
  });

  it("returns [WILDCARD_SCOPE] and stops early when wildcard appears among other scopes", () => {
    expect(normalizeRequestedScopes(["ocr:submit", "*", "ocr:read"])).toEqual([WILDCARD_SCOPE]);
  });

  it("deduplicates repeated valid scopes", () => {
    const result = normalizeRequestedScopes(["ocr:submit", "ocr:submit", "ocr:read"]);
    expect(result).toEqual(["ocr:submit", "ocr:read"]);
  });

  it("filters out invalid/unknown scopes", () => {
    const result = normalizeRequestedScopes(["ocr:submit", "not:a:scope", "invalid"]);
    expect(result).toEqual(["ocr:submit"]);
  });

  it("returns ALL_SCOPES for empty array input", () => {
    expect(normalizeRequestedScopes([])).toEqual([...ALL_SCOPES]);
  });

  it("returns ALL_SCOPES for empty JSON string array", () => {
    expect(normalizeRequestedScopes("[]")).toEqual([...ALL_SCOPES]);
  });

  it("returns ALL_SCOPES when all entries are invalid", () => {
    expect(normalizeRequestedScopes(["bogus", "not-real"])).toEqual([...ALL_SCOPES]);
  });

  it("returns only valid scopes from mixed valid+invalid input", () => {
    const result = normalizeRequestedScopes(["ocr:submit", "bogus", "settings:read"]);
    expect(result).toEqual(["ocr:submit", "settings:read"]);
  });

  it("accepts a JSON string array as input", () => {
    const result = normalizeRequestedScopes(JSON.stringify(["ocr:submit", "ocr:read"]));
    expect(result).toEqual(["ocr:submit", "ocr:read"]);
  });

  it("is case-insensitive for valid scopes", () => {
    const result = normalizeRequestedScopes(["OCR:SUBMIT", "Settings:Read"]);
    expect(result).toEqual(["ocr:submit", "settings:read"]);
  });

  it("trims whitespace around scope entries", () => {
    const result = normalizeRequestedScopes(["  ocr:submit  ", " ocr:read "]);
    expect(result).toEqual(["ocr:submit", "ocr:read"]);
  });

  it("skips blank/whitespace-only entries", () => {
    const result = normalizeRequestedScopes(["ocr:submit", "   ", ""]);
    expect(result).toEqual(["ocr:submit"]);
  });
});

describe("scopeListGrants", () => {
  it("grants any scope when the wildcard is present", () => {
    for (const scope of ALL_SCOPES) {
      expect(scopeListGrants(["*"], scope)).toBe(true);
    }
  });

  it("grants the scope when it is explicitly listed", () => {
    expect(scopeListGrants(["ocr:submit", "ocr:read"], "ocr:submit")).toBe(true);
  });

  it("denies a scope that is not in the list", () => {
    expect(scopeListGrants(["ocr:read"], "ocr:submit")).toBe(false);
  });

  it("denies when the list is empty", () => {
    expect(scopeListGrants([], "ocr:submit")).toBe(false);
  });

  it("denies when a different scope is listed but not the required one", () => {
    expect(scopeListGrants(["settings:read", "webhooks:write"], "ocr:submit")).toBe(false);
  });

  it("grants when wildcard is mixed with other entries", () => {
    expect(scopeListGrants(["ocr:read", "*"], "settings:write")).toBe(true);
  });
});
