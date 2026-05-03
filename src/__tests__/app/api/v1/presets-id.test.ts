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
  db: { outputPreset: { updateMany: vi.fn(), deleteMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { PATCH, DELETE } from "@/app/api/v1/presets/[id]/route";

const mockedUpdate = db.outputPreset.updateMany as ReturnType<typeof vi.fn>;
const mockedDelete = db.outputPreset.deleteMany as ReturnType<typeof vi.fn>;

function makeReq(method: "PATCH" | "DELETE", body?: unknown): NextRequest {
  return new Request("http://localhost/api/v1/presets/p1", {
    method,
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedUpdate.mockReset();
  mockedDelete.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("PATCH /api/v1/presets/[id]", () => {
  it("returns 400 when no fields to update", async () => {
    const res = await PATCH(makeReq("PATCH", {}), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is empty after trim", async () => {
    const res = await PATCH(makeReq("PATCH", { name: "   " }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 when outputFormat is bogus", async () => {
    const res = await PATCH(makeReq("PATCH", { outputFormat: "yaml" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when nothing was updated", async () => {
    mockedUpdate.mockResolvedValueOnce({ count: 0 });
    const res = await PATCH(makeReq("PATCH", { name: "new" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(404);
  });

  it("updates the preset scoped to the user", async () => {
    mockedUpdate.mockResolvedValueOnce({ count: 1 });
    const res = await PATCH(makeReq("PATCH", { name: "new", instruction: "do x", outputFormat: "json" }), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    expect(mockedUpdate.mock.calls[0][0].where).toEqual({ id: "p1", userId: "u1" });
    expect(mockedUpdate.mock.calls[0][0].data).toEqual({ name: "new", instruction: "do x", outputFormat: "json" });
  });
});

describe("DELETE /api/v1/presets/[id]", () => {
  it("returns 404 when nothing was deleted", async () => {
    mockedDelete.mockResolvedValueOnce({ count: 0 });
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("deletes the preset scoped to the user", async () => {
    mockedDelete.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    expect(mockedDelete.mock.calls[0][0].where).toEqual({ id: "p1", userId: "u1" });
  });
});
