import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  withSessionAuth: <P,>(_kind: string, _label: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) =>
    async (req: NextRequest, ctx: { params?: Promise<P> } = {}) => {
      try {
        return await handler(req, { auth: { method: "session", userId: "u1", scopes: ["*"] }, params: ctx.params ?? Promise.resolve({} as P) });
      } catch (error) {
        const status = error instanceof Error && "status" in error ? ((error as { status?: number }).status ?? 500) : 500;
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "internal" }), { status, headers: { "Content-Type": "application/json" } });
      }
    },
}));

vi.mock("@/lib/db", () => ({
  db: {
    apiKey: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/api-key", () => ({
  generateApiKey: () => ({ plaintext: "extr_secret", prefix: "extr_pre", keyHash: "hash" }),
}));

vi.mock("@/lib/auth/scopes", () => ({
  ALL_SCOPES: ["ocr:submit", "ocr:read", "*"],
  normalizeRequestedScopes: (scopes: unknown) => (Array.isArray(scopes) ? scopes : ["*"]),
  parseScopeList: (s: string) => s.split(","),
  serializeScopeList: (s: unknown[]) => s.join(","),
}));

import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/v1/keys/route";

const mockedFindMany = db.apiKey.findMany as ReturnType<typeof vi.fn>;
const mockedCount = db.apiKey.count as ReturnType<typeof vi.fn>;
const mockedCreate = db.apiKey.create as ReturnType<typeof vi.fn>;

function makeReq(method: "GET" | "POST" = "GET", body?: unknown): NextRequest {
  return new Request("http://localhost/api/v1/keys", {
    method,
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindMany.mockReset();
  mockedCount.mockReset().mockResolvedValue(0);
  mockedCreate.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/v1/keys", () => {
  it("lists the user's API keys with parsed scopes", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "k1", scopes: "ocr:submit,ocr:read", revokedAt: null },
    ]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].scopes).toEqual(["ocr:submit", "ocr:read"]);
    expect(body.availableScopes).toEqual(["ocr:submit", "ocr:read", "*"]);
  });
});

describe("POST /api/v1/keys", () => {
  it("returns 400 when name is missing", async () => {
    const res = await POST(makeReq("POST", {}));
    expect(res.status).toBe(400);
  });

  it("returns 409 when the user has reached the active-key cap", async () => {
    mockedCount.mockResolvedValueOnce(20);
    const res = await POST(makeReq("POST", { name: "ci" }));
    expect(res.status).toBe(409);
  });

  it("creates the key, returns 201, and surfaces the plaintext exactly once", async () => {
    mockedCreate.mockResolvedValueOnce({ id: "k1", name: "ci", prefix: "extr_pre", createdAt: new Date() });
    const res = await POST(makeReq("POST", { name: "ci" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key.plaintext).toBe("extr_secret");
    expect(body.warning).toContain("Store this key now");
  });

  it("rejects rateLimitPerMinute outside [1, 600]", async () => {
    const res = await POST(makeReq("POST", { name: "ci", rateLimitPerMinute: 9999 }));
    expect(res.status).toBe(400);
  });
});
