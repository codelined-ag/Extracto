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
}));

vi.mock("@/lib/db", () => ({
  db: { $queryRaw: vi.fn(), ocrJob: { findMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { GET } from "@/app/api/v1/search/route";

const mockedFindMany = db.ocrJob.findMany as ReturnType<typeof vi.fn>;
const mockedQueryRaw = db.$queryRaw as ReturnType<typeof vi.fn>;

function makeReq(query: string): NextRequest {
  return new Request(`http://localhost/api/v1/search?${query}`) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindMany.mockReset().mockResolvedValue([]);
  mockedQueryRaw.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/v1/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await GET(makeReq(""));
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is shorter than 2 chars", async () => {
    const res = await GET(makeReq("q=a"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is over 200 chars", async () => {
    const res = await GET(makeReq(`q=${"x".repeat(201)}`));
    expect(res.status).toBe(400);
  });

  it("returns matching jobs scoped to the current user", async () => {
    mockedQueryRaw.mockResolvedValueOnce([
      {
        id: "j1",
        fileName: "doc.pdf",
        status: "COMPLETED",
        model: "qwen",
        createdAt: new Date(),
        completedAt: null,
        snippet: "this is a test snippet",
        snippetStart: 1,
        textLength: 22,
      },
    ]);
    const res = await GET(makeReq("q=test"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.q).toBe("test");
    expect(body.count).toBe(1);
    expect(body.results[0].id).toBe("j1");
    expect(body.results[0].snippet).toContain("test");
    expect(mockedQueryRaw).toHaveBeenCalled();
  });

  it("clamps limit at 50", async () => {
    mockedQueryRaw.mockResolvedValueOnce([]);
    await GET(makeReq("q=foo&limit=999"));
    expect(JSON.stringify(mockedQueryRaw.mock.calls[0][0])).toContain("50");
  });
});
