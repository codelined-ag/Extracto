import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/token", () => ({
  getAuthCookieName: () => "estracto_session",
  verifySessionToken: vi.fn(),
}));

vi.mock("@/lib/auth/api-key-shared", () => ({
  extractBearerToken: (header: string | null) =>
    header?.startsWith("Bearer ") ? header.slice(7) : null,
  isLikelyApiKey: (value: string) => value.startsWith("extr_"),
}));

import { verifySessionToken } from "@/lib/auth/token";
import { middleware } from "../../middleware";
import { NextRequest } from "next/server";

const mockedVerify = verifySessionToken as ReturnType<typeof vi.fn>;

function makeRequest(pathname: string, init: { cookie?: string; auth?: string } = {}): NextRequest {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.auth) headers.set("authorization", init.auth);
  return new NextRequest(new URL(pathname, "http://localhost"), { headers });
}

beforeEach(() => {
  mockedVerify.mockReset();
  mockedVerify.mockResolvedValue(null);
});
afterEach(() => vi.clearAllMocks());

describe("middleware PUBLIC_PATHS allowlist", () => {
  it.each([
    "/auth",
    "/auth/login",
    "/api/auth",
    "/api/auth/session",
    "/api/health",
    "/api/v1/metrics",
    "/manifest.webmanifest",
    "/sw.js",
    "/extracto-favicon.svg",
    "/extracto-icon.svg",
    "/extracto-maskable.svg",
    "/logo.svg",
    "/robots.txt",
    "/_next/anything",
  ])("lets %s through with no auth", async (path) => {
    const res = await middleware(makeRequest(path));
    expect(res.status).toBe(200);
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it("does NOT treat root as public", async () => {
    const res = await middleware(makeRequest("/"));
    expect(res.status).not.toBe(200);
  });
});

describe("middleware authenticated session", () => {
  it("forwards an authenticated request with valid cookie", async () => {
    mockedVerify.mockResolvedValueOnce({ userId: "u1" });
    const res = await middleware(
      makeRequest("/dashboard", { cookie: "estracto_session=valid-token" }),
    );
    expect(res.status).toBe(200);
    expect(mockedVerify).toHaveBeenCalledWith("valid-token");
  });

  it("redirects unauthenticated browser requests to /auth", async () => {
    const res = await middleware(makeRequest("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth");
  });
});

describe("middleware bearer-token paths", () => {
  it("returns 401 JSON on /api/* without auth", async () => {
    const res = await middleware(makeRequest("/api/private"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("forwards /api/* requests with a likely API key bearer token", async () => {
    const res = await middleware(
      makeRequest("/api/private", { auth: "Bearer extr_some_key" }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects /api/* requests with a non-API-key bearer token", async () => {
    const res = await middleware(
      makeRequest("/api/private", { auth: "Bearer some-other-token" }),
    );
    expect(res.status).toBe(401);
  });
});
