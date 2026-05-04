import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  withAuth: <P,>(_scope: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) =>
    async (req: NextRequest) => {
      try {
        return await handler(req, { auth: { method: "session", userId: "u1", scopes: ["*"] }, params: Promise.resolve({} as P) });
      } catch (error) {
        const status = error instanceof Error && "status" in error ? ((error as { status?: number }).status ?? 500) : 500;
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "internal" }), { status, headers: { "Content-Type": "application/json" } });
      }
    },
  withMutationAuth: <P,>(_scope: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) =>
    async (req: NextRequest) => {
      try {
        return await handler(req, { auth: { method: "session", userId: "u1", scopes: ["*"] }, params: Promise.resolve({} as P) });
      } catch (error) {
        const status = error instanceof Error && "status" in error ? ((error as { status?: number }).status ?? 500) : 500;
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "internal" }), { status, headers: { "Content-Type": "application/json" } });
      }
    },
}));

vi.mock("@/lib/db", () => ({
  db: {
    tag: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/tags/route";

const mockedFindMany = db.tag.findMany as ReturnType<typeof vi.fn>;
const mockedUpsert = db.tag.upsert as ReturnType<typeof vi.fn>;

const makeReq = (url: string, init?: RequestInit) =>
  new Request(url, { headers: { origin: "http://localhost", "Content-Type": "application/json" }, ...init }) as unknown as NextRequest;

beforeEach(() => {
  mockedFindMany.mockReset();
  mockedUpsert.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/tags", () => {
  it("returns the user's tags with jobCount", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "t1", name: "invoices", color: "blue", createdAt: new Date(), _count: { jobTags: 4 } },
      { id: "t2", name: "drafts", color: "slate", createdAt: new Date(), _count: { jobTags: 0 } },
    ]);
    const res = await GET(makeReq("http://localhost/api/tags"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toHaveLength(2);
    expect(body.tags[0]).toMatchObject({ id: "t1", name: "invoices", color: "blue", jobCount: 4 });
    expect(mockedFindMany.mock.calls[0][0].where.userId).toBe("u1");
  });
});

describe("POST /api/tags", () => {
  it("creates or recolors by name (idempotent)", async () => {
    mockedUpsert.mockResolvedValueOnce({ id: "t1", name: "invoices", color: "blue", createdAt: new Date() });
    const res = await POST(
      makeReq("http://localhost/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: "  invoices ", color: "blue" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tag.name).toBe("invoices");
    expect(mockedUpsert.mock.calls[0][0].where.userId_name).toEqual({ userId: "u1", name: "invoices" });
    expect(mockedUpsert.mock.calls[0][0].create.color).toBe("blue");
  });

  it("rejects empty name", async () => {
    const res = await POST(
      makeReq("http://localhost/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: "  " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("falls back to slate for an invalid color", async () => {
    mockedUpsert.mockResolvedValueOnce({ id: "t1", name: "x", color: "slate", createdAt: new Date() });
    await POST(
      makeReq("http://localhost/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: "x", color: "neon" }),
      }),
    );
    expect(mockedUpsert.mock.calls[0][0].create.color).toBe("slate");
  });
});
