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
    ocrJob: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ocr/result-store", () => ({
  readResultText: vi.fn().mockResolvedValue("extracted text"),
  readResultJson: vi.fn().mockResolvedValue({ markdown: "x" }),
}));

import { db } from "@/lib/db";
import { GET, DELETE } from "@/app/api/jobs/[id]/route";

const mockedFindFirst = db.ocrJob.findFirst as ReturnType<typeof vi.fn>;
const mockedDeleteMany = db.ocrJob.deleteMany as ReturnType<typeof vi.fn>;

function makeReq(method: "GET" | "DELETE" = "GET"): NextRequest {
  return new Request("http://localhost/api/jobs/j1", { method, headers: { origin: "http://localhost" } }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindFirst.mockReset();
  mockedDeleteMany.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/jobs/[id]", () => {
  it("returns the job with hydrated extractedText + result", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "j1",
      status: "COMPLETED",
      fileName: "doc.pdf",
      sourcePreview: null,
      model: "qwen",
      createdAt: new Date(),
      completedAt: new Date(),
      processingMs: 1234,
      metadata: {},
      errorMessage: null,
      extractedText: "inline",
      extractedTextLocation: null,
      result: { markdown: "x" },
      resultLocation: null,
    });
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "j1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.job.id).toBe("j1");
    expect(body.job.extractedText).toBe("extracted text");
    expect(mockedFindFirst.mock.calls[0][0].where).toEqual({ id: "j1", userId: "u1" });
  });

  it("returns 404 when the job is not found in the user's scope", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when id is empty", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "" }) });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/jobs/[id]", () => {
  it("deletes a single job scoped to the user", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "j1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(1);
  });

  it("returns 404 when nothing was deleted", async () => {
    mockedDeleteMany.mockResolvedValueOnce({ count: 0 });
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "j2" }) });
    expect(res.status).toBe(404);
  });
});
