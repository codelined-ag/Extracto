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
    ocrJob: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/ocr/job-control", () => ({
  abortOcrJobRequests: vi.fn(),
  isOcrJobRunning: vi.fn().mockReturnValue(true),
  requestOcrJobStop: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { abortOcrJobRequests, isOcrJobRunning, requestOcrJobStop } from "@/lib/ocr/job-control";
import { POST } from "@/app/api/jobs/[id]/control/route";

const mockedFindFirst = db.ocrJob.findFirst as ReturnType<typeof vi.fn>;
const mockedAbort = abortOcrJobRequests as ReturnType<typeof vi.fn>;
const mockedRunning = isOcrJobRunning as ReturnType<typeof vi.fn>;
const mockedStop = requestOcrJobStop as ReturnType<typeof vi.fn>;

function makeReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/jobs/j1/control", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindFirst.mockReset();
  mockedAbort.mockReset();
  mockedRunning.mockReset().mockReturnValue(true);
  mockedStop.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/jobs/[id]/control", () => {
  it("returns 400 for an unsupported action", async () => {
    const res = await POST(makeReq({ action: "yeet" }), { params: Promise.resolve({ id: "j1" }) });
    expect(res.status).toBe(400);
    expect(mockedStop).not.toHaveBeenCalled();
  });

  it("returns 404 when the job belongs to another user", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ action: "stop" }), { params: Promise.resolve({ id: "j1" }) });
    expect(res.status).toBe(404);
  });

  it("requests stop, aborts in-flight requests, and reports running state", async () => {
    mockedFindFirst.mockResolvedValueOnce({ id: "j1", status: "PROCESSING", metadata: {} });
    const res = await POST(makeReq({ action: "stop" }), { params: Promise.resolve({ id: "j1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ stopRequested: true, running: true });
    expect(mockedStop).toHaveBeenCalledWith("j1");
    expect(mockedAbort).toHaveBeenCalledWith("j1");
  });

  it("returns 400 when id is empty", async () => {
    const res = await POST(makeReq({ action: "stop" }), { params: Promise.resolve({ id: "" }) });
    expect(res.status).toBe(400);
  });
});
