import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/auth/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/auth/helpers")>("@/app/api/auth/helpers");
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
  findUserByEmail: vi.fn(),
  verifyPassword: vi.fn(),
  toSafeUser: (u: { id: string; email: string; name: string | null }) => ({ id: u.id, email: u.email, name: u.name }),
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));

vi.mock("@/lib/auth/token", () => ({
  createSessionToken: vi.fn().mockResolvedValue("session-token"),
  getAuthCookieName: () => "estracto_session",
  getSessionMaxAgeSeconds: () => 3600,
  shouldUseSecureCookie: () => false,
}));

import { findUserByEmail, verifyPassword } from "@/lib/auth/credentials";
import { consumeRateLimit } from "@/lib/rate-limit";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { POST } from "@/app/api/auth/login/route";

const mockedFind = findUserByEmail as ReturnType<typeof vi.fn>;
const mockedVerify = verifyPassword as ReturnType<typeof vi.fn>;
const mockedRate = consumeRateLimit as ReturnType<typeof vi.fn>;
const mockedTrust = isTrustedMutationRequest as ReturnType<typeof vi.fn>;

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockedFind.mockReset();
  mockedVerify.mockReset();
  mockedRate.mockReset().mockReturnValue({ allowed: true });
  mockedTrust.mockReset().mockReturnValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/auth/login", () => {
  it("returns 403 when request origin is not trusted", async () => {
    mockedTrust.mockReturnValueOnce(false);
    const res = await POST(makeReq({ email: "a@b.co", password: "longpassword" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns 429 when IP rate-limit is exceeded", async () => {
    mockedRate.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(429);
  });

  it("returns 400 for missing email or short password", async () => {
    const res = await POST(makeReq({ email: "a@b.co", password: "short" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 401 for unknown user", async () => {
    mockedFind.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ email: "a@b.co", password: "longpassword" }) as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 for incorrect password", async () => {
    mockedFind.mockResolvedValueOnce({ id: "u1", email: "a@b.co", name: "A", passwordHash: "h" });
    mockedVerify.mockReturnValueOnce(false);
    const res = await POST(makeReq({ email: "a@b.co", password: "longpassword" }) as never);
    expect(res.status).toBe(401);
  });

  it("issues a session cookie + user payload on success", async () => {
    mockedFind.mockResolvedValueOnce({ id: "u1", email: "a@b.co", name: "A", passwordHash: "h" });
    mockedVerify.mockReturnValueOnce(true);
    const res = await POST(makeReq({ email: "a@b.co", password: "longpassword" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("estracto_session=");
    const body = await res.json();
    expect(body.user).toEqual({ id: "u1", email: "a@b.co", name: "A" });
  });
});
