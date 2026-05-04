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
    ocrJob: { findFirst: vi.fn() },
    tag: { findMany: vi.fn() },
    jobTag: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (ops) => Promise.all(ops)),
  },
}));

import { db } from "@/lib/db";
import { PUT } from "@/app/api/jobs/[id]/tags/route";

const mockedJobFindFirst = db.ocrJob.findFirst as ReturnType<typeof vi.fn>;
const mockedTagFindMany = db.tag.findMany as ReturnType<typeof vi.fn>;
const mockedJobTagDelete = db.jobTag.deleteMany as ReturnType<typeof vi.fn>;
const mockedJobTagCreate = db.jobTag.createMany as ReturnType<typeof vi.fn>;

const makeReq = (body: unknown) =>
  new Request("http://localhost/api/jobs/j1/tags", {
    method: "PUT",
    headers: { origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  mockedJobFindFirst.mockReset();
  mockedTagFindMany.mockReset();
  mockedJobTagDelete.mockReset();
  mockedJobTagCreate.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("PUT /api/jobs/[id]/tags", () => {
  it("replaces the tag set", async () => {
    mockedJobFindFirst.mockResolvedValueOnce({ id: "j1" });
    mockedTagFindMany
      .mockResolvedValueOnce([{ id: "t1" }, { id: "t2" }])
      .mockResolvedValueOnce([
        { id: "t1", name: "a", color: "blue" },
        { id: "t2", name: "b", color: "green" },
      ]);
    mockedJobTagDelete.mockResolvedValueOnce({ count: 0 });
    mockedJobTagCreate.mockResolvedValueOnce({ count: 2 });

    const res = await PUT(makeReq({ tagIds: ["t1", "t2", "t1"] }), {
      params: Promise.resolve({ id: "j1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toHaveLength(2);
    expect(mockedJobTagCreate.mock.calls[0][0].data).toEqual([
      { jobId: "j1", tagId: "t1" },
      { jobId: "j1", tagId: "t2" },
    ]);
  });

  it("clears all tags when given an empty array", async () => {
    mockedJobFindFirst.mockResolvedValueOnce({ id: "j1" });
    mockedTagFindMany.mockResolvedValueOnce([]);
    mockedJobTagDelete.mockResolvedValueOnce({ count: 3 });

    const res = await PUT(makeReq({ tagIds: [] }), {
      params: Promise.resolve({ id: "j1" }),
    });
    expect(res.status).toBe(200);
    expect(mockedJobTagCreate).not.toHaveBeenCalled();
  });

  it("returns 404 when the job is not owned by the caller", async () => {
    mockedJobFindFirst.mockResolvedValueOnce(null);
    const res = await PUT(makeReq({ tagIds: ["t1"] }), {
      params: Promise.resolve({ id: "j1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when a tagId is not owned by the caller", async () => {
    mockedJobFindFirst.mockResolvedValueOnce({ id: "j1" });
    mockedTagFindMany.mockResolvedValueOnce([{ id: "t1" }]);
    const res = await PUT(makeReq({ tagIds: ["t1", "tX"] }), {
      params: Promise.resolve({ id: "j1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when tagIds is not an array", async () => {
    const res = await PUT(makeReq({ tagIds: "nope" }), {
      params: Promise.resolve({ id: "j1" }),
    });
    expect(res.status).toBe(400);
  });
});
