import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isTrustedMutationRequest, getClientIpAddress } from "@/lib/request-security";

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

describe("isTrustedMutationRequest", () => {
  const base = "http://localhost:3000/api/test";

  it("trusts a same-origin request with matching Origin header", () => {
    const req = makeRequest(base, { origin: "http://localhost:3000" });
    expect(isTrustedMutationRequest(req)).toBe(true);
  });

  it("rejects a cross-origin request", () => {
    const req = makeRequest(base, { origin: "http://evil.com" });
    expect(isTrustedMutationRequest(req)).toBe(false);
  });

  it("trusts when sec-fetch-site is same-origin and no Origin header", () => {
    const req = makeRequest(base, { "sec-fetch-site": "same-origin" });
    expect(isTrustedMutationRequest(req)).toBe(true);
  });

  it("trusts when sec-fetch-site is same-site", () => {
    const req = makeRequest(base, { "sec-fetch-site": "same-site" });
    expect(isTrustedMutationRequest(req)).toBe(true);
  });

  it("rejects when sec-fetch-site is cross-site", () => {
    const req = makeRequest(base, { "sec-fetch-site": "cross-site" });
    expect(isTrustedMutationRequest(req)).toBe(false);
  });

  it("rejects when no Origin, Referer, or sec-fetch-site", () => {
    const req = makeRequest(base);
    expect(isTrustedMutationRequest(req)).toBe(false);
  });

  it("trusts same-origin request via matching Referer", () => {
    const req = makeRequest(base, { referer: "http://localhost:3000/some-page" });
    expect(isTrustedMutationRequest(req)).toBe(true);
  });

  it("rejects cross-origin Referer", () => {
    const req = makeRequest(base, { referer: "http://attacker.com/page" });
    expect(isTrustedMutationRequest(req)).toBe(false);
  });

  it("normalizes 127.0.0.1 to localhost for origin comparison", () => {
    const req = makeRequest("http://127.0.0.1:3000/api/test", {
      origin: "http://localhost:3000",
    });
    expect(isTrustedMutationRequest(req)).toBe(true);
  });

  it("trusts x-forwarded-host matching the Origin header", () => {
    const req = makeRequest(base, {
      origin: "http://app.example.com",
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "http",
    });
    expect(isTrustedMutationRequest(req)).toBe(true);
  });

  it("rejects invalid Origin value", () => {
    const req = makeRequest(base, { origin: "not-a-url" });
    expect(isTrustedMutationRequest(req)).toBe(false);
  });

  it("trusts sec-fetch-site=none (no-cors or navigation)", () => {
    const req = makeRequest(base, { "sec-fetch-site": "none" });
    expect(isTrustedMutationRequest(req)).toBe(true);
  });
});

describe("getClientIpAddress", () => {
  it("returns the first IP from x-forwarded-for", () => {
    const req = makeRequest("http://localhost:3000/", {
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(getClientIpAddress(req)).toBe("1.2.3.4");
  });

  it("returns x-real-ip when x-forwarded-for is absent", () => {
    const req = makeRequest("http://localhost:3000/", {
      "x-real-ip": "9.9.9.9",
    });
    expect(getClientIpAddress(req)).toBe("9.9.9.9");
  });

  it("returns 'unknown' when no IP headers present", () => {
    const req = makeRequest("http://localhost:3000/");
    expect(getClientIpAddress(req)).toBe("unknown");
  });

  it("trims whitespace from x-real-ip", () => {
    const req = makeRequest("http://localhost:3000/", {
      "x-real-ip": "  10.0.0.1  ",
    });
    expect(getClientIpAddress(req)).toBe("10.0.0.1");
  });
});
