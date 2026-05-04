import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/request-security", () => ({
  isTrustedMutationRequest: vi.fn().mockReturnValue(true),
  getClientIpAddress: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock("@/lib/auth/credentials", () => ({
  findUserByEmail: vi.fn(),
  createUser: vi.fn(),
  toSafeUser: (u: { id: string; email: string; name: string | null }) => ({ id: u.id, email: u.email, name: u.name }),
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));

vi.mock("@/lib/auth/token", () => ({
  createSessionToken: vi.fn().mockResolvedValue("session-token"),
  getAuthCookieName: () => "estracto_session",
  getSessionMaxAgeSeconds: () => 3600,
  shouldUseSecureCookie: () => false,
}));

vi.mock("@/app/api/auth/helpers", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/auth/helpers")>("@/app/api/auth/helpers");
  return {
    ...actual,
    isRequestSecure: () => false,
  };
});

import { findUserByEmail, createUser } from "@/lib/auth/credentials";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { POST } from "@/app/api/auth/signup/route";

const mockedFind = findUserByEmail as ReturnType<typeof vi.fn>;
const mockedCreate = createUser as ReturnType<typeof vi.fn>;
const mockedTrust = isTrustedMutationRequest as ReturnType<typeof vi.fn>;

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockedFind.mockReset();
  mockedCreate.mockReset();
  mockedTrust.mockReset().mockReturnValue(true);
  process.env.ALLOW_SIGNUP = "1";
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/auth/signup", () => {
  it("returns 403 when ALLOW_SIGNUP is disabled", async () => {
    process.env.ALLOW_SIGNUP = "0";
    const res = await POST(makeReq({ email: "a@b.co", password: "longpass1234" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns 403 when origin is not trusted", async () => {
    mockedTrust.mockReturnValueOnce(false);
    const res = await POST(makeReq({ email: "a@b.co", password: "longpass1234" }) as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 for password shorter than MIN_PASSWORD_LENGTH (12)", async () => {
    const res = await POST(makeReq({ email: "a@b.co", password: "short" }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 409 when email is already registered", async () => {
    mockedFind.mockResolvedValueOnce({ id: "u1", email: "a@b.co" });
    const res = await POST(makeReq({ email: "a@b.co", password: "longpass1234" }) as never);
    expect(res.status).toBe(409);
  });

  it("creates the user and issues a session cookie on success", async () => {
    mockedFind.mockResolvedValueOnce(null);
    mockedCreate.mockResolvedValueOnce({ id: "u1", email: "a@b.co", name: "A", passwordChangedAt: new Date() });
    const res = await POST(makeReq({ email: "a@b.co", password: "longpass1234", name: "A" }) as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("estracto_session=");
    expect(mockedCreate).toHaveBeenCalled();
  });
});
