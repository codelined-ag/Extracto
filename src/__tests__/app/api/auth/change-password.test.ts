import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/auth/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/auth/helpers")>(
    "@/app/api/auth/helpers",
  );
  return {
    ...actual,
    isRequestSecure: () => false,
  };
});

vi.mock("@/lib/request-security", () => ({
  isTrustedMutationRequest: vi.fn().mockReturnValue(true),
  getClientIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock("@/lib/auth/credentials", () => ({
  findUserById: vi.fn(),
  updateUserPassword: vi.fn().mockResolvedValue(new Date()),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/auth/token", () => ({
  createSessionToken: vi.fn().mockResolvedValue("fresh-token"),
  getAuthCookieName: () => "estracto_session",
  getSessionMaxAgeSeconds: () => 3600,
  shouldUseSecureCookie: () => false,
  verifySessionToken: vi.fn(),
}));

vi.mock("@/lib/auth/api-key", () => ({
  extractBearerToken: vi.fn().mockReturnValue(null),
  isLikelyApiKey: vi.fn().mockReturnValue(false),
  hashApiKey: vi.fn(),
  compareKeyHashes: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    apiKey: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  },
}));

import { NextRequest } from "next/server";

import { findUserById, updateUserPassword, verifyPassword } from "@/lib/auth/credentials";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { createSessionToken, verifySessionToken } from "@/lib/auth/token";
import { extractBearerToken } from "@/lib/auth/api-key";
import { POST } from "@/app/api/auth/change-password/route";

const mockedFind = findUserById as ReturnType<typeof vi.fn>;
const mockedUpdate = updateUserPassword as ReturnType<typeof vi.fn>;
const mockedVerify = verifyPassword as ReturnType<typeof vi.fn>;
const mockedRate = consumeRateLimit as ReturnType<typeof vi.fn>;
const mockedTrust = isTrustedMutationRequest as ReturnType<typeof vi.fn>;
const mockedSession = verifySessionToken as ReturnType<typeof vi.fn>;
const mockedBearer = extractBearerToken as ReturnType<typeof vi.fn>;
const mockedCreateToken = createSessionToken as ReturnType<typeof vi.fn>;

function makeReq(body: unknown, opts: { cookie?: string; bearer?: string } = {}): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    origin: "http://localhost",
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return new NextRequest("http://localhost/api/auth/change-password", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_SESSION = { userId: "u1", email: "a@b.co", name: "A" };
const VALID_USER = {
  id: "u1",
  email: "a@b.co",
  name: "A",
  passwordHash: "hash",
  passwordChangedAt: new Date(),
};

beforeEach(() => {
  mockedFind.mockReset();
  mockedUpdate.mockReset().mockResolvedValue(new Date());
  mockedVerify.mockReset();
  mockedRate.mockReset().mockReturnValue({ allowed: true });
  mockedTrust.mockReset().mockReturnValue(true);
  mockedSession.mockReset().mockResolvedValue(VALID_SESSION);
  mockedBearer.mockReset().mockReturnValue(null);
  mockedCreateToken.mockReset().mockResolvedValue("fresh-token");
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/auth/change-password", () => {
  it("returns 401 when no session cookie is present", async () => {
    mockedSession.mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "newpasswordhere1" }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when origin is not trusted", async () => {
    mockedTrust.mockReturnValueOnce(false);
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "newpasswordhere1" }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("returns 429 when IP rate-limit is exceeded", async () => {
    mockedRate.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "newpasswordhere1" }) as never,
    );
    expect(res.status).toBe(429);
  });

  it("returns 429 when per-user rate-limit is exceeded", async () => {
    mockedRate
      .mockReturnValueOnce({ allowed: true })
      .mockReturnValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "newpasswordhere1" }) as never,
    );
    expect(res.status).toBe(429);
  });

  it("returns 400 when fields are missing", async () => {
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when new password is too short", async () => {
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "short" }) as never,
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when current password is wrong", async () => {
    mockedFind.mockResolvedValueOnce(VALID_USER);
    mockedVerify.mockReturnValueOnce(false);
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "newpasswordhere1" }) as never,
    );
    expect(res.status).toBe(401);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when new password equals current (after verifying current)", async () => {
    mockedFind.mockResolvedValueOnce(VALID_USER);
    mockedVerify.mockReturnValueOnce(true);
    const same = "longpasswordhere";
    const res = await POST(
      makeReq({ currentPassword: same, newPassword: same }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 when the session-bound user no longer exists", async () => {
    mockedFind.mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "newpasswordhere1" }) as never,
    );
    expect(res.status).toBe(401);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("updates the password and refreshes the session cookie on success", async () => {
    mockedFind.mockResolvedValueOnce(VALID_USER);
    mockedVerify.mockReturnValueOnce(true);
    const res = await POST(
      makeReq({ currentPassword: "longpasswordhere", newPassword: "newpasswordhere1" }) as never,
    );
    expect(res.status).toBe(200);
    expect(mockedUpdate).toHaveBeenCalledWith("u1", "newpasswordhere1");
    expect(mockedCreateToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        email: "a@b.co",
        name: "A",
        pv: expect.any(Number),
      }),
    );
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("estracto_session=fresh-token");
  });

  it("uses the userId from the session, ignoring any userId in the body", async () => {
    mockedFind.mockResolvedValueOnce(VALID_USER);
    mockedVerify.mockReturnValueOnce(true);
    const res = await POST(
      makeReq({
        currentPassword: "longpasswordhere",
        newPassword: "newpasswordhere1",
        userId: "attacker-target",
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(mockedFind).toHaveBeenCalledWith("u1");
    expect(mockedUpdate).toHaveBeenCalledWith("u1", "newpasswordhere1");
  });
});
