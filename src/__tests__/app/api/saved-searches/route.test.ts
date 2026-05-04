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
    savedSearch: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    tag: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/saved-searches/route";

const mockedFindMany = db.savedSearch.findMany as ReturnType<typeof vi.fn>;
const mockedUpsert = db.savedSearch.upsert as ReturnType<typeof vi.fn>;
const mockedTagFindMany = db.tag.findMany as ReturnType<typeof vi.fn>;

const makeReq = (url: string, init?: RequestInit) =>
  new Request(url, { headers: { origin: "http://localhost", "Content-Type": "application/json" }, ...init }) as unknown as NextRequest;

beforeEach(() => {
  mockedFindMany.mockReset();
  mockedUpsert.mockReset();
  mockedTagFindMany.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/saved-searches", () => {
  it("returns the user's saved searches", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "s1", name: "Q1 invoices", filters: { q: "invoice" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const res = await GET(makeReq("http://localhost/api/saved-searches"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.savedSearches).toHaveLength(1);
    expect(mockedFindMany.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("strips deleted tag ids from the returned filters", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "s1", name: "with-tags", filters: { tagIds: ["t-live", "t-deleted"] }, createdAt: new Date(), updatedAt: new Date() },
      { id: "s2", name: "all-stale", filters: { tagIds: ["t-deleted"] }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    mockedTagFindMany.mockResolvedValueOnce([{ id: "t-live" }]);
    const res = await GET(makeReq("http://localhost/api/saved-searches"));
    const body = await res.json();
    expect(body.savedSearches[0].filters.tagIds).toEqual(["t-live"]);
    expect(body.savedSearches[1].filters.tagIds).toBeUndefined();
  });
});

describe("POST /api/saved-searches", () => {
  it("upserts and normalizes filter input", async () => {
    mockedUpsert.mockResolvedValueOnce({
      id: "s1",
      name: "Latest failures",
      filters: { status: "FAILED" },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await POST(
      makeReq("http://localhost/api/saved-searches", {
        method: "POST",
        body: JSON.stringify({
          name: "  Latest failures ",
          filters: { status: "FAILED", q: "  ", junk: "ignored", tagIds: ["t1", "", "t1"] },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const create = mockedUpsert.mock.calls[0][0].create;
    expect(create.name).toBe("Latest failures");
    expect(create.filters).toEqual({ status: "FAILED", tagIds: ["t1"] });
  });

  it("rejects empty name", async () => {
    const res = await POST(
      makeReq("http://localhost/api/saved-searches", {
        method: "POST",
        body: JSON.stringify({ name: "  ", filters: {} }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("drops invalid status from filters", async () => {
    mockedUpsert.mockResolvedValueOnce({ id: "s1", name: "x", filters: {}, createdAt: new Date(), updatedAt: new Date() });
    await POST(
      makeReq("http://localhost/api/saved-searches", {
        method: "POST",
        body: JSON.stringify({ name: "x", filters: { status: "BOGUS" } }),
      }),
    );
    expect(mockedUpsert.mock.calls[0][0].create.filters).toEqual({});
  });
});
