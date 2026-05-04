import { describe, expect, it } from "vitest";

import { assertKeyUnderPrefix } from "@/lib/s3/client";

describe("assertKeyUnderPrefix", () => {
  it("accepts keys under the prefix", () => {
    expect(() => assertKeyUnderPrefix("extracto", "extracto/jobs/abc.md")).not.toThrow();
    expect(() => assertKeyUnderPrefix("extracto", "extracto")).not.toThrow();
  });

  it("rejects keys outside the configured prefix (cross-tenant escape)", () => {
    expect(() => assertKeyUnderPrefix("extracto", "other-tenant/secrets.json")).toThrow(/outside/);
    expect(() => assertKeyUnderPrefix("tenant-a", "tenant-b/foo")).toThrow(/outside/);
  });

  it("rejects '..' segments in keys", () => {
    expect(() => assertKeyUnderPrefix("extracto", "extracto/../other/leak")).toThrow(/\.\./);
  });

  it("rejects control characters in keys", () => {
    expect(() => assertKeyUnderPrefix("extracto", "extracto/foo\nbar")).toThrow(/control/);
    expect(() => assertKeyUnderPrefix("extracto", "extracto/foo\x00bar")).toThrow(/control/);
  });

  it("requires a non-empty key", () => {
    expect(() => assertKeyUnderPrefix("extracto", "")).toThrow();
  });

  it("with empty prefix accepts any well-formed key", () => {
    expect(() => assertKeyUnderPrefix("", "anything/here.txt")).not.toThrow();
  });
});
