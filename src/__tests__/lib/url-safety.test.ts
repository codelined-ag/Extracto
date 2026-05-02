import { describe, it, expect } from "vitest";

import {
  isAllowedExternalUrl,
  isPrivateOrLoopbackHost,
  parseAllowlist,
} from "@/lib/url-safety";

describe("isPrivateOrLoopbackHost", () => {
  it.each([
    ["10.0.0.1", true],
    ["10.255.255.254", true],
    ["172.16.0.1", true],
    ["172.31.255.254", true],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["169.254.1.1", true],
    ["100.64.0.1", true],
    ["127.0.0.1", true],
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["192.0.0.1", true],
    ["192.0.2.1", true],
    ["198.18.0.1", true],
    ["198.51.100.1", true],
    ["203.0.113.1", true],
    ["255.255.255.255", true],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["13.107.42.14", false],
    ["::1", true],
    ["::", true],
    ["::ffff:127.0.0.1", true],
    ["::ffff:8.8.8.8", false],
    ["fe80::1", true],
    ["febf::1", true],
    ["fc00::1", true],
    ["fd00::1", true],
    ["ff02::1", true],
    ["2001:db8::1", false],
    ["2606:4700:4700::1111", false],
    ["localhost", true],
    ["LOCALHOST", true],
    ["foo.local", true],
    ["bar.internal", true],
    ["baz.lan", true],
    ["api.example.com", false],
  ])("classifies %s as private=%s", (host, expected) => {
    expect(isPrivateOrLoopbackHost(host)).toBe(expected);
  });
});

describe("isAllowedExternalUrl — protocol + private guard", () => {
  it("rejects non-http(s) schemes", () => {
    expect(isAllowedExternalUrl("ftp://example.com/", []).ok).toBe(false);
    expect(isAllowedExternalUrl("file:///etc/passwd", []).ok).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)", []).ok).toBe(false);
  });

  it("rejects private and loopback hostnames regardless of allowlist", () => {
    expect(isAllowedExternalUrl("http://10.0.0.1/", []).ok).toBe(false);
    expect(isAllowedExternalUrl("http://localhost/", ["localhost"]).ok).toBe(false);
    expect(isAllowedExternalUrl("https://127.0.0.1/", ["127.0.0.1"]).ok).toBe(false);
  });

  it("accepts public URL when allowlist is empty", () => {
    expect(isAllowedExternalUrl("https://hooks.slack.com/services/X", []).ok).toBe(true);
  });
});

describe("isAllowedExternalUrl — allowlist semantics", () => {
  it("matches exact host", () => {
    expect(isAllowedExternalUrl("https://api.example.com/x", ["api.example.com"]).ok).toBe(true);
  });

  it("rejects host not in allowlist", () => {
    expect(isAllowedExternalUrl("https://other.example.com/x", ["api.example.com"]).ok).toBe(false);
  });

  it("supports leading-dot subdomain wildcard", () => {
    expect(isAllowedExternalUrl("https://api.example.com/x", [".example.com"]).ok).toBe(true);
    expect(isAllowedExternalUrl("https://example.com/x", [".example.com"]).ok).toBe(true);
    expect(isAllowedExternalUrl("https://attacker-example.com/x", [".example.com"]).ok).toBe(false);
  });

  it("does NOT substring-match on bare entry", () => {
    expect(isAllowedExternalUrl("https://evil-example.com/x", ["example.com"]).ok).toBe(false);
  });

  it("matches subdomain via dot suffix on bare entry", () => {
    expect(isAllowedExternalUrl("https://api.example.com/x", ["example.com"]).ok).toBe(true);
  });

  it("rejects unknown URL", () => {
    expect(isAllowedExternalUrl("not a url", []).ok).toBe(false);
  });
});

describe("parseAllowlist", () => {
  it("returns empty array on null/undefined/empty", () => {
    expect(parseAllowlist(null)).toEqual([]);
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
  });

  it("trims and drops empties", () => {
    expect(parseAllowlist(" a , b , ,c ")).toEqual(["a", "b", "c"]);
  });
});

describe("resolveAndCheckExternalUrl", () => {
  it("returns ok=false when surface check fails (private host)", async () => {
    const { resolveAndCheckExternalUrl } = await import("@/lib/url-safety");
    const r = await resolveAndCheckExternalUrl("http://10.0.0.1/x", []);
    expect(r.ok).toBe(false);
  });

  it("returns ok=false when surface check fails (non-http scheme)", async () => {
    const { resolveAndCheckExternalUrl } = await import("@/lib/url-safety");
    const r = await resolveAndCheckExternalUrl("ftp://example.com", []);
    expect(r.ok).toBe(false);
  });

  it("skips DNS lookup for literal IPv4", async () => {
    const { resolveAndCheckExternalUrl } = await import("@/lib/url-safety");
    const r = await resolveAndCheckExternalUrl("http://8.8.8.8/test", []);
    expect(r.ok).toBe(true);
  });

  it("skips DNS lookup for literal IPv6", async () => {
    const { resolveAndCheckExternalUrl } = await import("@/lib/url-safety");
    const r = await resolveAndCheckExternalUrl("http://[2606:4700:4700::1111]/test", []);
    expect(r.ok).toBe(true);
  });

  it("returns ok=false when allowlist rejects the host", async () => {
    const { resolveAndCheckExternalUrl } = await import("@/lib/url-safety");
    const r = await resolveAndCheckExternalUrl("https://example.com", ["other.com"]);
    expect(r.ok).toBe(false);
  });
});
