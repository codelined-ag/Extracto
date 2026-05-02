import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports of the module under test.
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    apiKey: {
      findUnique: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("@/lib/auth/token", () => ({
  verifySessionToken: vi.fn(),
  getAuthCookieName: vi.fn().mockReturnValue("estracto_session"),
}));

vi.mock("@/lib/auth/api-key", () => ({
  extractBearerToken: vi.fn(),
  hashApiKey: vi.fn(),
  compareKeyHashes: vi.fn(),
  isLikelyApiKey: vi.fn(),
}));

vi.mock("@/lib/request-security", () => ({
  isTrustedMutationRequest: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import mocked modules + module under test.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { verifySessionToken, getAuthCookieName } from "@/lib/auth/token";
import {
  extractBearerToken,
  hashApiKey,
  compareKeyHashes,
  isLikelyApiKey,
} from "@/lib/auth/api-key";
import { isTrustedMutationRequest } from "@/lib/request-security";

import {
  authenticateRequest,
  authHasScope,
  requireScope,
  authenticateMutation,
  withAuth,
  withMutationAuth,
  withSessionAuth,
  type AuthContext,
} from "@/lib/auth/request";

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockDb = db as {
  apiKey: { findUnique: ReturnType<typeof vi.fn> };
  $executeRaw: ReturnType<typeof vi.fn>;
};
const mockVerifySessionToken = verifySessionToken as ReturnType<typeof vi.fn>;
const mockGetAuthCookieName = getAuthCookieName as ReturnType<typeof vi.fn>;
const mockExtractBearerToken = extractBearerToken as ReturnType<typeof vi.fn>;
const mockHashApiKey = hashApiKey as ReturnType<typeof vi.fn>;
const mockCompareKeyHashes = compareKeyHashes as ReturnType<typeof vi.fn>;
const mockIsLikelyApiKey = isLikelyApiKey as ReturnType<typeof vi.fn>;
const mockIsTrustedMutationRequest = isTrustedMutationRequest as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Minimal NextRequest factory — cast a plain Request so we don't need Next
// internals, but we do need to support cookies.get() for the session path.
// ---------------------------------------------------------------------------

function makeRequest(options: {
  authorization?: string;
  cookieName?: string;
  cookieValue?: string;
} = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (options.authorization) {
    headers["authorization"] = options.authorization;
  }
  if (options.cookieName && options.cookieValue) {
    headers["cookie"] = `${options.cookieName}=${options.cookieValue}`;
  }

  const req = new Request("http://localhost/test", { headers });

  // Attach a minimal cookies accessor that mirrors what NextRequest exposes.
  (req as unknown as { cookies: { get: (name: string) => { value: string } | undefined } }).cookies =
    {
      get(name: string) {
        const match = headers["cookie"]?.match(
          new RegExp(`(?:^|;\\s*)${name}=([^;]*)`)
        );
        return match ? { value: match[1] } : undefined;
      },
    };

  return req as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Shared valid API key record fixture
// ---------------------------------------------------------------------------

const VALID_KEY_RECORD = {
  id: "key-id-123",
  userId: "user-abc",
  keyHash: "deadbeef",
  revokedAt: null,
  scopes: JSON.stringify(["ocr:submit", "ocr:read"]),
  rateLimitPerMinute: 60,
  monthlyResetAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Restore sensible defaults so each test starts clean.
  mockGetAuthCookieName.mockReturnValue("estracto_session");
  mockExtractBearerToken.mockReturnValue(null);
  mockIsLikelyApiKey.mockReturnValue(false);
  mockVerifySessionToken.mockResolvedValue(null);
  mockIsTrustedMutationRequest.mockReturnValue(true);
  mockDb.apiKey.findUnique.mockResolvedValue(null);
  mockHashApiKey.mockReturnValue("deadbeef");
  mockCompareKeyHashes.mockReturnValue(true);
  mockDb.$executeRaw.mockResolvedValue(0);
  process.env.AUTH_SECRET = "this-is-a-32-char-test-secret!!x";
});

// ---------------------------------------------------------------------------
// authenticateRequest — Bearer / API key path
// ---------------------------------------------------------------------------

describe("authenticateRequest with valid Bearer token", () => {
  it("returns AuthContext with method:'api-key' when the key is valid", async () => {
    mockExtractBearerToken.mockReturnValue("extr_validtoken");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockHashApiKey.mockReturnValue("deadbeef");
    mockDb.apiKey.findUnique.mockResolvedValue(VALID_KEY_RECORD);
    mockCompareKeyHashes.mockReturnValue(true);

    const req = makeRequest({ authorization: "Bearer extr_validtoken" });
    const ctx = await authenticateRequest(req);

    expect(ctx).not.toBeNull();
    expect(ctx!.method).toBe("api-key");
    expect(ctx!.userId).toBe("user-abc");
    expect(ctx!.apiKeyId).toBe("key-id-123");
    expect(ctx!.scopes).toEqual(["ocr:submit", "ocr:read"]);
    expect(ctx!.rateLimitPerMinute).toBe(60);
  });

  it("fires the usage update query (fire-and-forget)", async () => {
    mockExtractBearerToken.mockReturnValue("extr_validtoken");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockDb.apiKey.findUnique.mockResolvedValue(VALID_KEY_RECORD);
    mockCompareKeyHashes.mockReturnValue(true);

    const req = makeRequest({ authorization: "Bearer extr_validtoken" });
    await authenticateRequest(req);

    // Give the void promise a tick to settle.
    await Promise.resolve();
    expect(mockDb.$executeRaw).toHaveBeenCalledOnce();
  });
});

describe("authenticateRequest with invalid / revoked Bearer token", () => {
  it("returns null when the key is not found in the database", async () => {
    mockExtractBearerToken.mockReturnValue("extr_unknowntoken");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockDb.apiKey.findUnique.mockResolvedValue(null);

    const req = makeRequest({ authorization: "Bearer extr_unknowntoken" });
    const ctx = await authenticateRequest(req);

    expect(ctx).toBeNull();
  });

  it("returns null when the key has been revoked", async () => {
    mockExtractBearerToken.mockReturnValue("extr_revokedtoken");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockDb.apiKey.findUnique.mockResolvedValue({
      ...VALID_KEY_RECORD,
      revokedAt: new Date("2024-01-01"),
    });

    const req = makeRequest({ authorization: "Bearer extr_revokedtoken" });
    const ctx = await authenticateRequest(req);

    expect(ctx).toBeNull();
  });

  it("returns null when hash comparison fails (key mismatch)", async () => {
    mockExtractBearerToken.mockReturnValue("extr_mismatchtoken");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockDb.apiKey.findUnique.mockResolvedValue(VALID_KEY_RECORD);
    mockCompareKeyHashes.mockReturnValue(false);

    const req = makeRequest({ authorization: "Bearer extr_mismatchtoken" });
    const ctx = await authenticateRequest(req);

    expect(ctx).toBeNull();
  });

  it("returns null when the token doesn't look like an API key", async () => {
    mockExtractBearerToken.mockReturnValue("not_an_api_key");
    mockIsLikelyApiKey.mockReturnValue(false);

    const req = makeRequest({ authorization: "Bearer not_an_api_key" });
    const ctx = await authenticateRequest(req);

    expect(ctx).toBeNull();
    // DB should never be hit.
    expect(mockDb.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when hashApiKey throws", async () => {
    mockExtractBearerToken.mockReturnValue("extr_badtoken");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockHashApiKey.mockImplementation(() => {
      throw new Error("hash error");
    });

    const req = makeRequest({ authorization: "Bearer extr_badtoken" });
    const ctx = await authenticateRequest(req);

    expect(ctx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// authenticateRequest — session cookie path
// ---------------------------------------------------------------------------

describe("authenticateRequest with valid session cookie", () => {
  it("returns AuthContext with method:'session' and WILDCARD_SCOPE", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({
      userId: "session-user-1",
      email: "user@example.com",
      exp: 9999999999,
    });

    const req = makeRequest({
      cookieName: "estracto_session",
      cookieValue: "valid.token",
    });
    const ctx = await authenticateRequest(req);

    expect(ctx).not.toBeNull();
    expect(ctx!.method).toBe("session");
    expect(ctx!.userId).toBe("session-user-1");
    expect(ctx!.apiKeyId).toBeNull();
    expect(ctx!.scopes).toEqual(["*"]);
    expect(ctx!.rateLimitPerMinute).toBeNull();
  });
});

describe("authenticateRequest with no credentials", () => {
  it("returns null when there is no Bearer token and no valid session cookie", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue(null);

    const req = makeRequest();
    const ctx = await authenticateRequest(req);

    expect(ctx).toBeNull();
  });

  it("returns null when session cookie exists but token verification fails", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue(null);

    const req = makeRequest({
      cookieName: "estracto_session",
      cookieValue: "invalid.token",
    });
    const ctx = await authenticateRequest(req);

    expect(ctx).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// authHasScope
// ---------------------------------------------------------------------------

describe("authHasScope", () => {
  const baseCtx = (scopes: string[]): AuthContext => ({
    userId: "u1",
    method: "api-key",
    apiKeyId: "k1",
    scopes,
    rateLimitPerMinute: null,
  });

  it("returns true when the context holds the wildcard scope", () => {
    const ctx = baseCtx(["*"]);
    expect(authHasScope(ctx, "ocr:submit")).toBe(true);
    expect(authHasScope(ctx, "settings:write")).toBe(true);
  });

  it("returns true when the specific scope is explicitly granted", () => {
    const ctx = baseCtx(["ocr:submit", "ocr:read"]);
    expect(authHasScope(ctx, "ocr:submit")).toBe(true);
    expect(authHasScope(ctx, "ocr:read")).toBe(true);
  });

  it("returns false when the scope is not in the granted list", () => {
    const ctx = baseCtx(["ocr:submit"]);
    expect(authHasScope(ctx, "settings:write")).toBe(false);
    expect(authHasScope(ctx, "webhooks:read")).toBe(false);
  });

  it("returns false when the scope list is empty", () => {
    const ctx = baseCtx([]);
    expect(authHasScope(ctx, "ocr:submit")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireScope
// ---------------------------------------------------------------------------

describe("requireScope", () => {
  const baseCtx = (scopes: string[]): AuthContext => ({
    userId: "u1",
    method: "api-key",
    apiKeyId: "k1",
    scopes,
    rateLimitPerMinute: null,
  });

  it("returns null when the required scope is granted", () => {
    const ctx = baseCtx(["ocr:submit"]);
    const result = requireScope(ctx, "ocr:submit");
    expect(result).toBeNull();
  });

  it("returns null when the wildcard scope is held", () => {
    const ctx = baseCtx(["*"]);
    const result = requireScope(ctx, "settings:write");
    expect(result).toBeNull();
  });

  it("returns a 403 NextResponse when the scope is not granted", async () => {
    const ctx = baseCtx(["ocr:read"]);
    const result = requireScope(ctx, "settings:write");

    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);

    const body = await result!.json();
    expect(body).toMatchObject({ error: expect.stringContaining("settings:write") });
  });
});

// ---------------------------------------------------------------------------
// authenticateMutation
// ---------------------------------------------------------------------------

describe("authenticateMutation", () => {
  it("returns 401 when there is no valid auth", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue(null);

    const req = makeRequest();
    const result = await authenticateMutation(req);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(401);
  });

  it("returns { ok: true, auth } for a trusted session request", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({
      userId: "session-user-2",
      email: "user@example.com",
      exp: 9999999999,
    });
    mockIsTrustedMutationRequest.mockReturnValue(true);

    const req = makeRequest({
      cookieName: "estracto_session",
      cookieValue: "valid.token",
    });
    const result = await authenticateMutation(req);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.method).toBe("session");
      expect(result.auth.userId).toBe("session-user-2");
    }
  });

  it("returns 403 for a session request from an untrusted origin", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({
      userId: "session-user-3",
      email: "user@example.com",
      exp: 9999999999,
    });
    mockIsTrustedMutationRequest.mockReturnValue(false);

    const req = makeRequest({
      cookieName: "estracto_session",
      cookieValue: "valid.token",
    });
    const result = await authenticateMutation(req);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; status: number }).status).toBe(403);
  });

  it("bypasses origin check for API key auth (no CSRF required)", async () => {
    mockExtractBearerToken.mockReturnValue("extr_validtoken");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockDb.apiKey.findUnique.mockResolvedValue(VALID_KEY_RECORD);
    mockCompareKeyHashes.mockReturnValue(true);
    // Origin is untrusted — should not matter for API key auth.
    mockIsTrustedMutationRequest.mockReturnValue(false);

    const req = makeRequest({ authorization: "Bearer extr_validtoken" });
    const result = await authenticateMutation(req);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.method).toBe("api-key");
    }
    // isTrustedMutationRequest must NOT have been called for api-key path.
    expect(mockIsTrustedMutationRequest).not.toHaveBeenCalled();
  });
});

describe("withAuth higher-order wrapper", () => {
  function setupSessionAuth() {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({ userId: "u1" });
    mockGetAuthCookieName.mockReturnValue("estracto_session");
  }

  it("passes auth context to the inner handler when authenticated and scope OK", async () => {
    setupSessionAuth();
    const handler = vi.fn(async (_req, _ctx) => new Response("ok"));
    const wrapped = withAuth("ocr:read", handler);
    const req = makeRequest({ cookie: "estracto_session=valid" });
    const resp = await wrapped(req);

    expect(resp.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    const ctxArg = handler.mock.calls[0][1] as { auth: AuthContext };
    expect(ctxArg.auth.method).toBe("session");
    expect(ctxArg.auth.userId).toBe("u1");
  });

  it("returns 401 when not authenticated; handler not called", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue(null);
    const handler = vi.fn();
    const wrapped = withAuth("ocr:read", handler);

    const resp = await wrapped(makeRequest());
    expect(resp.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when scope is missing; handler not called", async () => {
    mockExtractBearerToken.mockReturnValue("extr_x");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockHashApiKey.mockResolvedValue("hashed");
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1",
      userId: "u1",
      keyHash: "hashed",
      revokedAt: null,
      scopes: '["ocr:read"]',
      rateLimitPerMinute: null,
      monthlyResetAt: new Date(),
    });
    mockCompareKeyHashes.mockReturnValue(true);
    const handler = vi.fn();
    const wrapped = withAuth("settings:write", handler);

    const resp = await wrapped(makeRequest({ authorization: "Bearer extr_x" }));
    expect(resp.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("converts thrown errors via handleApiError (returns 500 JSON)", async () => {
    setupSessionAuth();
    const wrapped = withAuth("ocr:read", async () => {
      throw new Error("boom");
    });
    const resp = await wrapped(makeRequest({ cookie: "estracto_session=v" }));
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error).toBe("boom");
  });

  it("preserves params in the context object", async () => {
    setupSessionAuth();
    const handler = vi.fn(async (_req, ctx) => {
      const params = await ctx.params;
      return Response.json({ id: (params as { id: string }).id });
    });
    const wrapped = withAuth<{ id: string }>("ocr:read", handler);
    const req = makeRequest({ cookie: "estracto_session=v" });
    const resp = await wrapped(req, { params: Promise.resolve({ id: "abc" }) });
    const body = await resp.json();
    expect(body.id).toBe("abc");
  });
});

describe("withMutationAuth higher-order wrapper", () => {
  function setupSessionAuth() {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({ userId: "u1" });
    mockGetAuthCookieName.mockReturnValue("estracto_session");
  }

  it("returns 200 when session auth + trusted origin + scope OK", async () => {
    setupSessionAuth();
    mockIsTrustedMutationRequest.mockReturnValue(true);
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withMutationAuth("settings:write", handler);

    const resp = await wrapped(makeRequest({ cookie: "estracto_session=v" }));
    expect(resp.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns 403 when session is untrusted origin (CSRF guard); handler not called", async () => {
    setupSessionAuth();
    mockIsTrustedMutationRequest.mockReturnValue(false);
    const handler = vi.fn();
    const wrapped = withMutationAuth("settings:write", handler);

    const resp = await wrapped(makeRequest({ cookie: "estracto_session=v" }));
    expect(resp.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("API key auth bypasses the origin check", async () => {
    mockExtractBearerToken.mockReturnValue("extr_x");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockHashApiKey.mockResolvedValue("hashed");
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1",
      userId: "u1",
      keyHash: "hashed",
      revokedAt: null,
      scopes: '["*"]',
      rateLimitPerMinute: null,
      monthlyResetAt: new Date(),
    });
    mockCompareKeyHashes.mockReturnValue(true);
    mockIsTrustedMutationRequest.mockReturnValue(false); // shouldn't matter
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withMutationAuth("settings:write", handler);

    const resp = await wrapped(makeRequest({ authorization: "Bearer extr_x" }));
    expect(resp.status).toBe(200);
    expect(mockIsTrustedMutationRequest).not.toHaveBeenCalled();
  });

  it("converts thrown errors via handleApiError", async () => {
    setupSessionAuth();
    mockIsTrustedMutationRequest.mockReturnValue(true);
    const wrapped = withMutationAuth("settings:write", async () => {
      throw new Error("write failed");
    });
    const resp = await wrapped(makeRequest({ cookie: "estracto_session=v" }));
    expect(resp.status).toBe(500);
    const body = await resp.json();
    expect(body.error).toBe("write failed");
  });
});

describe("withSessionAuth (read mode)", () => {
  it("calls handler when session-authenticated", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({ userId: "u1" });
    mockGetAuthCookieName.mockReturnValue("estracto_session");
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withSessionAuth("read", "API keys", handler);

    const resp = await wrapped(makeRequest({ cookie: "estracto_session=v" }));
    expect(resp.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns 401 when not authenticated", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue(null);
    const handler = vi.fn();
    const wrapped = withSessionAuth("read", "API keys", handler);

    const resp = await wrapped(makeRequest());
    expect(resp.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 with resource-specific message when authenticated via API key", async () => {
    mockExtractBearerToken.mockReturnValue("extr_x");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockHashApiKey.mockResolvedValue("hashed");
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1",
      userId: "u1",
      keyHash: "hashed",
      revokedAt: null,
      scopes: '["*"]',
      rateLimitPerMinute: null,
      monthlyResetAt: new Date(),
    });
    mockCompareKeyHashes.mockReturnValue(true);
    const handler = vi.fn();
    const wrapped = withSessionAuth("read", "API keys", handler);

    const resp = await wrapped(makeRequest({ authorization: "Bearer extr_x" }));
    expect(resp.status).toBe(403);
    const body = await resp.json();
    expect(body.error).toBe("API keys can only be viewed via an interactive session");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withSessionAuth (mutation mode)", () => {
  it("returns 200 when session + trusted origin", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({ userId: "u1" });
    mockGetAuthCookieName.mockReturnValue("estracto_session");
    mockIsTrustedMutationRequest.mockReturnValue(true);
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withSessionAuth("mutation", "API keys", handler);

    const resp = await wrapped(makeRequest({ cookie: "estracto_session=v" }));
    expect(resp.status).toBe(200);
  });

  it("returns 403 with 'modified' message when authenticated via API key", async () => {
    mockExtractBearerToken.mockReturnValue("extr_x");
    mockIsLikelyApiKey.mockReturnValue(true);
    mockHashApiKey.mockResolvedValue("hashed");
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "k1",
      userId: "u1",
      keyHash: "hashed",
      revokedAt: null,
      scopes: '["*"]',
      rateLimitPerMinute: null,
      monthlyResetAt: new Date(),
    });
    mockCompareKeyHashes.mockReturnValue(true);
    mockIsTrustedMutationRequest.mockReturnValue(true);
    const handler = vi.fn();
    const wrapped = withSessionAuth("mutation", "API keys", handler);

    const resp = await wrapped(makeRequest({ authorization: "Bearer extr_x" }));
    expect(resp.status).toBe(403);
    const body = await resp.json();
    expect(body.error).toBe("API keys can only be modified via an interactive session");
  });

  it("returns 403 when session origin untrusted (CSRF guard)", async () => {
    mockExtractBearerToken.mockReturnValue(null);
    mockVerifySessionToken.mockResolvedValue({ userId: "u1" });
    mockGetAuthCookieName.mockReturnValue("estracto_session");
    mockIsTrustedMutationRequest.mockReturnValue(false);
    const handler = vi.fn();
    const wrapped = withSessionAuth("mutation", "API keys", handler);

    const resp = await wrapped(makeRequest({ cookie: "estracto_session=v" }));
    expect(resp.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
