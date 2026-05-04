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

const mockTxClient = {
  jobTag: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    ocrJob: { findMany: vi.fn() },
    tag: { findMany: vi.fn() },
    jobTag: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (arg) => {
      if (typeof arg === "function") return arg(mockTxClient);
      return Promise.all(arg);
    }),
  },
}));

import { db } from "@/lib/db";
import { POST } from "@/app/api/jobs/bulk/tags/route";

const mockedJobFind = db.ocrJob.findMany as ReturnType<typeof vi.fn>;
const mockedTagFind = db.tag.findMany as ReturnType<typeof vi.fn>;
const mockedJobTagFind = db.jobTag.findMany as ReturnType<typeof vi.fn>;
const mockedJobTagDelete = db.jobTag.deleteMany as ReturnType<typeof vi.fn>;
const mockedJobTagCreate = db.jobTag.createMany as ReturnType<typeof vi.fn>;

const makeReq = (body: unknown) =>
  new Request("http://localhost/api/jobs/bulk/tags", {
    method: "POST",
    headers: { origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  mockedJobFind.mockReset();
  mockedTagFind.mockReset();
  mockedJobTagFind.mockReset();
  mockedJobTagDelete.mockReset();
  mockedJobTagCreate.mockReset();
  mockTxClient.jobTag.findMany.mockReset();
  mockTxClient.jobTag.createMany.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/jobs/bulk/tags", () => {
  it("adds tags to many jobs and skips already-existing pairs (transactionally)", async () => {
    mockedJobFind.mockResolvedValueOnce([{ id: "j1" }, { id: "j2" }]);
    mockedTagFind.mockResolvedValueOnce([{ id: "t1" }]);
    mockTxClient.jobTag.findMany.mockResolvedValueOnce([{ jobId: "j1", tagId: "t1" }]);
    mockTxClient.jobTag.createMany.mockResolvedValueOnce({ count: 1 });

    const res = await POST(makeReq({ jobIds: ["j1", "j2"], tagIds: ["t1"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ updated: 2, mode: "add" });
    expect(mockTxClient.jobTag.createMany.mock.calls[0][0].data).toEqual([
      { jobId: "j2", tagId: "t1" },
    ]);
  });

  it("rejects an unknown mode value", async () => {
    const res = await POST(makeReq({ jobIds: ["j1"], tagIds: [], mode: "wipe" }));
    expect(res.status).toBe(400);
  });

  it("replace mode clears then writes deduped pairs", async () => {
    mockedJobFind.mockResolvedValueOnce([{ id: "j1" }, { id: "j2" }]);
    mockedTagFind.mockResolvedValueOnce([{ id: "t1" }]);
    mockedJobTagDelete.mockResolvedValueOnce({ count: 5 });
    mockedJobTagCreate.mockResolvedValueOnce({ count: 2 });

    const res = await POST(
      makeReq({ jobIds: ["j1", "j2"], tagIds: ["t1"], mode: "replace" }),
    );
    expect(res.status).toBe(200);
    expect(mockedJobTagDelete.mock.calls[0][0].where).toEqual({ jobId: { in: ["j1", "j2"] } });
    expect(mockedJobTagCreate.mock.calls[0][0].data).toEqual([
      { jobId: "j1", tagId: "t1" },
      { jobId: "j2", tagId: "t1" },
    ]);
  });

  it("replace with empty tagIds clears tags from all listed jobs", async () => {
    mockedJobFind.mockResolvedValueOnce([{ id: "j1" }]);
    mockedJobTagDelete.mockResolvedValueOnce({ count: 3 });
    const res = await POST(makeReq({ jobIds: ["j1"], tagIds: [], mode: "replace" }));
    expect(res.status).toBe(200);
    expect(mockedJobTagCreate).not.toHaveBeenCalled();
  });

  it("rejects when any jobId is not owned by the caller", async () => {
    mockedJobFind.mockResolvedValueOnce([{ id: "j1" }]);
    const res = await POST(makeReq({ jobIds: ["j1", "j-foreign"], tagIds: ["t1"] }));
    expect(res.status).toBe(404);
  });

  it("rejects when any tagId is not owned by the caller", async () => {
    mockedJobFind.mockResolvedValueOnce([{ id: "j1" }]);
    mockedTagFind.mockResolvedValueOnce([]);
    const res = await POST(makeReq({ jobIds: ["j1"], tagIds: ["t1-foreign"] }));
    expect(res.status).toBe(404);
  });

  it("rejects when jobIds is missing", async () => {
    const res = await POST(makeReq({ tagIds: ["t1"] }));
    expect(res.status).toBe(400);
  });

  it("rejects empty jobIds", async () => {
    const res = await POST(makeReq({ jobIds: [], tagIds: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects more than 200 jobIds", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `j${i}`);
    const res = await POST(makeReq({ jobIds: ids, tagIds: [] }));
    expect(res.status).toBe(413);
  });
});
