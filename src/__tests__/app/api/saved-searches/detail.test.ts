import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
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
    savedSearch: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { PATCH, DELETE } from "@/app/api/saved-searches/[id]/route";

const mockedFindFirst = db.savedSearch.findFirst as ReturnType<typeof vi.fn>;
const mockedFindUnique = db.savedSearch.findUnique as ReturnType<typeof vi.fn>;
const mockedUpdateMany = db.savedSearch.updateMany as ReturnType<typeof vi.fn>;
const mockedDeleteMany = db.savedSearch.deleteMany as ReturnType<typeof vi.fn>;

const makeReq = (init?: RequestInit) =>
  new Request("http://localhost/api/saved-searches/s1", {
    headers: { origin: "http://localhost", "Content-Type": "application/json" },
    ...init,
  }) as unknown as NextRequest;

beforeEach(() => {
  mockedFindFirst.mockReset();
  mockedFindUnique.mockReset();
  mockedUpdateMany.mockReset();
  mockedDeleteMany.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("PATCH /api/saved-searches/[id]", () => {
  it("renames a saved search", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedFindUnique.mockResolvedValueOnce({ id: "s1", name: "renamed", filters: {}, createdAt: new Date(), updatedAt: new Date() });
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ name: "renamed" }) }),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(res.status).toBe(200);
    expect(mockedUpdateMany.mock.calls[0][0].data).toEqual({ name: "renamed" });
  });

  it("returns 409 if the new name collides with a sibling", async () => {
    mockedFindFirst.mockResolvedValueOnce({ id: "s99" });
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ name: "duplicate" }) }),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(res.status).toBe(409);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 400 if no fields supplied", async () => {
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("normalizes filters when patched", async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedFindUnique.mockResolvedValueOnce({ id: "s1", name: "x", filters: {}, createdAt: new Date(), updatedAt: new Date() });
    await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ filters: { status: "BOGUS", q: "  ok  " } }) }),
      { params: Promise.resolve({ id: "s1" }) },
    );
    expect(mockedUpdateMany.mock.calls[0][0].data.filters).toEqual({ q: "ok" });
  });
});

describe("DELETE /api/saved-searches/[id]", () => {
  it("deletes the saved search", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE(makeReq({ method: "DELETE" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(200);
  });

  it("returns 404 when nothing was deleted", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 0 });
    const res = await DELETE(makeReq({ method: "DELETE" }), { params: Promise.resolve({ id: "s1" }) });
    expect(res.status).toBe(404);
  });
});
