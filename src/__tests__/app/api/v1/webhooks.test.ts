import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  withAuth: <P,>(_scope: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) =>
    async (req: NextRequest, ctx: { params?: Promise<P> } = {}) => {
      try {
        return await handler(req, { auth: { method: "session", userId: "u1", scopes: ["*"] }, params: ctx.params ?? Promise.resolve({} as P) });
      } catch (error) {
        const status = error instanceof Error && "status" in error ? ((error as { status?: number }).status ?? 500) : 500;
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "internal" }), { status, headers: { "Content-Type": "application/json" } });
      }
    },
  withMutationAuth: <P,>(_scope: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) =>
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
    webhook: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/url-safety", () => ({
  isAllowedExternalUrl: vi.fn().mockReturnValue({ ok: true }),
  parseAllowlist: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/background/webhooks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/background/webhooks")>("@/lib/background/webhooks");
  return {
    ...actual,
    generateWebhookSecret: () => "whsec_fixed_test_secret",
    encryptWebhookSecret: (plain: string) => `enc:${plain}`,
  };
});

import { db } from "@/lib/db";
import { isAllowedExternalUrl } from "@/lib/url-safety";
import { GET, POST } from "@/app/api/v1/webhooks/route";

const mockedFindMany = db.webhook.findMany as ReturnType<typeof vi.fn>;
const mockedCount = db.webhook.count as ReturnType<typeof vi.fn>;
const mockedCreate = db.webhook.create as ReturnType<typeof vi.fn>;
const mockedSafety = isAllowedExternalUrl as ReturnType<typeof vi.fn>;

function makeReq(method: "GET" | "POST" = "GET", body?: unknown): NextRequest {
  return new Request("http://localhost/api/v1/webhooks", {
    method,
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindMany.mockReset();
  mockedCount.mockReset().mockResolvedValue(0);
  mockedCreate.mockReset();
  mockedSafety.mockReset().mockReturnValue({ ok: true });
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/v1/webhooks", () => {
  it("lists the user's webhooks with parsed events", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "w1", url: "https://example.com/h", events: '["job.completed"]', active: true, createdAt: new Date() },
    ]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks[0].events).toEqual(["job.completed"]);
    expect(mockedFindMany.mock.calls[0][0].where.userId).toBe("u1");
  });
});

describe("POST /api/v1/webhooks", () => {
  it("returns 400 when url is missing", async () => {
    const res = await POST(makeReq("POST", { events: ["job.completed"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the URL fails the safety policy", async () => {
    mockedSafety.mockReturnValueOnce({ ok: false, reason: "Loopback addresses are blocked" });
    const res = await POST(makeReq("POST", { url: "http://127.0.0.1/h" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Loopback/);
  });

  it("returns 409 when the per-user webhook cap is reached", async () => {
    mockedCount.mockResolvedValueOnce(20);
    const res = await POST(makeReq("POST", { url: "https://example.com/h" }));
    expect(res.status).toBe(409);
  });

  it("creates the webhook, returns 201, and surfaces the signing secret exactly once", async () => {
    mockedCreate.mockResolvedValueOnce({
      id: "w1", url: "https://example.com/h", events: '["job.completed","job.failed"]',
      active: true, createdAt: new Date(),
    });
    const res = await POST(makeReq("POST", { url: "https://example.com/h" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.webhook.secret).toBe("whsec_fixed_test_secret");
    expect(body.warning).toContain("Store this signing secret now");
  });
});
