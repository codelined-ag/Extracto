import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/token", () => ({
  verifySessionToken: vi.fn(),
  getAuthCookieName: () => "estracto_session",
  shouldUseSecureCookie: () => false,
}));

vi.mock("@/lib/db", () => ({
  db: { authUser: { findUnique: vi.fn() } },
}));

vi.mock("@/lib/request-security", () => ({
  isTrustedMutationRequest: vi.fn().mockReturnValue(true),
}));

vi.mock("@/app/api/auth/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/auth/helpers")>("@/app/api/auth/helpers");
  return {
    ...actual,
    isRequestSecure: () => false,
  };
});

import { db } from "@/lib/db";
import { verifySessionToken } from "@/lib/auth/token";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { GET as SESSION } from "@/app/api/auth/session/route";
import { POST as SIGNOUT } from "@/app/api/auth/signout/route";

const mockedVerify = verifySessionToken as ReturnType<typeof vi.fn>;
const mockedFindUser = db.authUser.findUnique as ReturnType<typeof vi.fn>;
const mockedTrust = isTrustedMutationRequest as ReturnType<typeof vi.fn>;

function makeReq(cookie?: string): NextRequest {
  const headers = new Headers({ origin: "http://localhost" });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL("http://localhost/api/auth/session"), { headers });
}

beforeEach(() => {
  mockedVerify.mockReset();
  mockedFindUser.mockReset();
  mockedTrust.mockReset().mockReturnValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/auth/session", () => {
  it("returns 401 + { authenticated: false } when there is no session token", async () => {
    mockedVerify.mockResolvedValueOnce(null);
    const res = await SESSION(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  });

  it("returns 401 when token is valid but user no longer exists", async () => {
    mockedVerify.mockResolvedValueOnce({ userId: "u1", email: "x", name: "x", pv: 1 });
    mockedFindUser.mockResolvedValueOnce(null);
    const res = await SESSION(makeReq("estracto_session=t"));
    expect(res.status).toBe(401);
  });

  it("returns 200 + user payload when both token and user are valid", async () => {
    mockedVerify.mockResolvedValueOnce({ userId: "u1", email: "a@b.co", name: "A", pv: 1 });
    mockedFindUser
      .mockResolvedValueOnce({ passwordChangedAt: new Date(0) })
      .mockResolvedValueOnce({ id: "u1", email: "a@b.co", name: "A" });
    const res = await SESSION(makeReq("estracto_session=t"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      authenticated: true,
      user: { id: "u1", email: "a@b.co", name: "A" },
    });
  });
});

describe("POST /api/auth/signout", () => {
  it("returns 403 when origin is not trusted", async () => {
    mockedTrust.mockReturnValueOnce(false);
    const res = await SIGNOUT(makeReq());
    expect(res.status).toBe(403);
  });

  it("returns 204 + clears the session cookie on success", async () => {
    const res = await SIGNOUT(makeReq("estracto_session=t"));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("estracto_session=");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
