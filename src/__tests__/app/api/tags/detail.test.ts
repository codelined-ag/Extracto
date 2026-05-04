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
    tag: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { PATCH, DELETE } from "@/app/api/tags/[id]/route";

const mockedUpdateMany = db.tag.updateMany as ReturnType<typeof vi.fn>;
const mockedFindUnique = db.tag.findUnique as ReturnType<typeof vi.fn>;
const mockedFindFirst = db.tag.findFirst as ReturnType<typeof vi.fn>;
const mockedDeleteMany = db.tag.deleteMany as ReturnType<typeof vi.fn>;

const makeReq = (init?: RequestInit) =>
  new Request("http://localhost/api/tags/t1", {
    headers: { origin: "http://localhost", "Content-Type": "application/json" },
    ...init,
  }) as unknown as NextRequest;

beforeEach(() => {
  mockedUpdateMany.mockReset();
  mockedFindUnique.mockReset();
  mockedFindFirst.mockReset();
  mockedDeleteMany.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("PATCH /api/tags/[id]", () => {
  it("renames and recolors", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    mockedUpdateMany.mockResolvedValueOnce({ count: 1 });
    mockedFindUnique.mockResolvedValueOnce({ id: "t1", name: "renamed", color: "green", createdAt: new Date() });
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ name: "renamed", color: "green" }) }),
      { params: Promise.resolve({ id: "t1" }) },
    );
    expect(res.status).toBe(200);
    expect(mockedUpdateMany.mock.calls[0][0].data).toEqual({ name: "renamed", color: "green" });
  });

  it("returns 409 if a sibling tag already uses the new name", async () => {
    mockedFindFirst.mockResolvedValueOnce({ id: "t99" });
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ name: "duplicate" }) }),
      { params: Promise.resolve({ id: "t1" }) },
    );
    expect(res.status).toBe(409);
    expect(mockedUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 400 when no fields supplied", async () => {
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: "t1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid color", async () => {
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ color: "neon" }) }),
      { params: Promise.resolve({ id: "t1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 if not owned", async () => {
    mockedUpdateMany.mockResolvedValueOnce({ count: 0 });
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ color: "green" }) }),
      { params: Promise.resolve({ id: "t1" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tags/[id]", () => {
  it("deletes the tag", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE(makeReq({ method: "DELETE" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(1);
  });

  it("returns 404 when nothing was deleted", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 0 });
    const res = await DELETE(makeReq({ method: "DELETE" }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(404);
  });
});
