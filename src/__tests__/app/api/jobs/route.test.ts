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
    ocrJob: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { GET, DELETE } from "@/app/api/jobs/route";

const mockedFindMany = db.ocrJob.findMany as ReturnType<typeof vi.fn>;
const mockedDeleteMany = db.ocrJob.deleteMany as ReturnType<typeof vi.fn>;

function makeRequest(url: string, method: "GET" | "DELETE" = "GET"): NextRequest {
  return new Request(url, { method, headers: { origin: "http://localhost" } }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindMany.mockReset();
  mockedDeleteMany.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/jobs", () => {
  it("returns the user's jobs (default limit 20)", async () => {
    mockedFindMany.mockResolvedValueOnce([
      { id: "j1", jobTags: [] },
      {
        id: "j2",
        jobTags: [{ tag: { id: "t1", name: "invoices", color: "blue" } }],
      },
    ]);
    const res = await GET(makeRequest("http://localhost/api/jobs"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs[0].tags).toEqual([]);
    expect(body.jobs[1].tags).toEqual([{ id: "t1", name: "invoices", color: "blue" }]);
    expect(mockedFindMany.mock.calls[0][0].take).toBe(20);
    expect(mockedFindMany.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("clamps limit at 100", async () => {
    mockedFindMany.mockResolvedValueOnce([]);
    await GET(makeRequest("http://localhost/api/jobs?limit=999"));
    expect(mockedFindMany.mock.calls[0][0].take).toBe(100);
  });

  it("filters by valid status", async () => {
    mockedFindMany.mockResolvedValueOnce([]);
    await GET(makeRequest("http://localhost/api/jobs?status=COMPLETED"));
    expect(mockedFindMany.mock.calls[0][0].where.status).toBe("COMPLETED");
  });

  it("returns 400 for an invalid status filter", async () => {
    const res = await GET(makeRequest("http://localhost/api/jobs?status=BOGUS"));
    expect(res.status).toBe(400);
    expect(mockedFindMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/jobs", () => {
  it("bulk-deletes the user's jobs", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 5 });
    const res = await DELETE(makeRequest("http://localhost/api/jobs", "DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(5);
    expect(mockedDeleteMany.mock.calls[0][0].where.userId).toBe("u1");
  });

  it("scopes the deletion to a status filter when provided", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 3 });
    await DELETE(makeRequest("http://localhost/api/jobs?status=FAILED", "DELETE"));
    expect(mockedDeleteMany.mock.calls[0][0].where.status).toBe("FAILED");
  });

  it("returns 400 for an invalid status filter", async () => {
    const res = await DELETE(makeRequest("http://localhost/api/jobs?status=BOGUS", "DELETE"));
    expect(res.status).toBe(400);
    expect(mockedDeleteMany).not.toHaveBeenCalled();
  });
});
