import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { buildOcrForwardHeaders, resolveInternalOcrEndpoint } from "@/lib/ocr/forward";

const ORIGINAL_PORT = process.env.PORT;

beforeEach(() => {
  delete process.env.PORT;
});

afterEach(() => {
  if (ORIGINAL_PORT === undefined) delete process.env.PORT;
  else process.env.PORT = ORIGINAL_PORT;
});

describe("resolveInternalOcrEndpoint", () => {
  it("defaults to port 3000 when PORT is unset", () => {
    expect(resolveInternalOcrEndpoint()).toBe("http://127.0.0.1:3000/api/ocr");
  });

  it("uses the PORT env var when set", () => {
    process.env.PORT = "8080";
    expect(resolveInternalOcrEndpoint()).toBe("http://127.0.0.1:8080/api/ocr");
  });

  it("always uses 127.0.0.1 (loopback) regardless of host bindings", () => {
    process.env.PORT = "4000";
    expect(resolveInternalOcrEndpoint()).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("PORT='' (empty) falls back to default 3000 only via ?? not || (so empty string is preserved)", () => {
    // The implementation uses ?? — empty string is a value, not nullish.
    // Document the actual behavior: empty PORT yields ":/api/ocr" not ":3000/api/ocr".
    process.env.PORT = "";
    expect(resolveInternalOcrEndpoint()).toBe("http://127.0.0.1:/api/ocr");
  });
});

function makeRequest(opts: {
  origin?: string;
  cookie?: string;
  authorization?: string;
} = {}): NextRequest {
  const origin = opts.origin ?? "https://app.example.com";
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.authorization) headers.set("authorization", opts.authorization);
  return {
    nextUrl: { origin } as URL,
    headers,
  } as unknown as NextRequest;
}

describe("buildOcrForwardHeaders", () => {
  it("includes Content-Type, Origin, and Referer", () => {
    const headers = buildOcrForwardHeaders(makeRequest({ origin: "https://my.app" }));
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Origin).toBe("https://my.app");
    expect(headers.Referer).toBe("https://my.app");
  });

  it("forwards the Cookie header when present", () => {
    const headers = buildOcrForwardHeaders(
      makeRequest({ cookie: "session=abc; theme=dark" })
    );
    expect(headers.Cookie).toBe("session=abc; theme=dark");
  });

  it("does NOT include Cookie when absent", () => {
    const headers = buildOcrForwardHeaders(makeRequest({}));
    expect(headers.Cookie).toBeUndefined();
  });

  it("forwards the Authorization header when present", () => {
    const headers = buildOcrForwardHeaders(
      makeRequest({ authorization: "Bearer abc123" })
    );
    expect(headers.Authorization).toBe("Bearer abc123");
  });

  it("does NOT include Authorization when absent", () => {
    const headers = buildOcrForwardHeaders(makeRequest({}));
    expect(headers.Authorization).toBeUndefined();
  });

  it("forwards both Cookie and Authorization simultaneously", () => {
    const headers = buildOcrForwardHeaders(
      makeRequest({ cookie: "x=1", authorization: "Bearer y" })
    );
    expect(headers.Cookie).toBe("x=1");
    expect(headers.Authorization).toBe("Bearer y");
  });

  it("Origin and Referer match the request's nextUrl.origin", () => {
    const headers = buildOcrForwardHeaders(makeRequest({ origin: "http://localhost:3000" }));
    expect(headers.Origin).toBe("http://localhost:3000");
    expect(headers.Referer).toBe("http://localhost:3000");
  });
});
