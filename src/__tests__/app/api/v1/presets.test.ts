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
    outputPreset: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/v1/presets/route";

const mockedFindMany = db.outputPreset.findMany as ReturnType<typeof vi.fn>;
const mockedCount = db.outputPreset.count as ReturnType<typeof vi.fn>;
const mockedCreate = db.outputPreset.create as ReturnType<typeof vi.fn>;

function makeReq(method: "GET" | "POST" = "GET", body?: unknown): NextRequest {
  return new Request("http://localhost/api/v1/presets", {
    method,
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindMany.mockReset();
  mockedCount.mockReset().mockResolvedValue(0);
  mockedCreate.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("GET /api/v1/presets", () => {
  it("lists presets scoped to the current user", async () => {
    mockedFindMany.mockResolvedValueOnce([{ id: "p1", name: "Cleanup", outputFormat: "markdown" }]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.presets[0].id).toBe("p1");
    expect(mockedFindMany.mock.calls[0][0].where.userId).toBe("u1");
  });
});

describe("POST /api/v1/presets", () => {
  it("returns 400 when name is missing", async () => {
    const res = await POST(makeReq("POST", { instruction: "do x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when instruction is empty", async () => {
    const res = await POST(makeReq("POST", { name: "foo", instruction: "" }));
    expect(res.status).toBe(400);
  });

  it("creates the preset with markdown default outputFormat", async () => {
    mockedCreate.mockResolvedValueOnce({
      id: "p1", name: "x", instruction: "y", outputFormat: "markdown",
      createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await POST(makeReq("POST", { name: "x", instruction: "y" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.preset.outputFormat).toBe("markdown");
  });
});
