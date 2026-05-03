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
  db: { webhook: { updateMany: vi.fn(), deleteMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { PATCH, DELETE } from "@/app/api/v1/webhooks/[id]/route";

const mockedUpdate = db.webhook.updateMany as ReturnType<typeof vi.fn>;
const mockedDelete = db.webhook.deleteMany as ReturnType<typeof vi.fn>;

function makeReq(method: "PATCH" | "DELETE", body?: unknown): NextRequest {
  return new Request("http://localhost/api/v1/webhooks/w1", {
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

describe("PATCH /api/v1/webhooks/[id]", () => {
  it("returns 400 when active is missing or non-boolean", async () => {
    const res = await PATCH(makeReq("PATCH", {}), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when nothing was updated", async () => {
    mockedUpdate.mockResolvedValueOnce({ count: 0 });
    const res = await PATCH(makeReq("PATCH", { active: false }), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("toggles the active flag scoped to the user", async () => {
    mockedUpdate.mockResolvedValueOnce({ count: 1 });
    const res = await PATCH(makeReq("PATCH", { active: false }), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(200);
    expect(mockedUpdate.mock.calls[0][0]).toEqual({ where: { id: "w1", userId: "u1" }, data: { active: false } });
  });
});

describe("DELETE /api/v1/webhooks/[id]", () => {
  it("returns 404 when nothing was deleted", async () => {
    mockedDelete.mockResolvedValueOnce({ count: 0 });
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("deletes the webhook scoped to the user", async () => {
    mockedDelete.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE(makeReq("DELETE"), { params: Promise.resolve({ id: "w1" }) });
    expect(res.status).toBe(200);
    expect(mockedDelete.mock.calls[0][0].where).toEqual({ id: "w1", userId: "u1" });
  });
});
