import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  withSessionAuth: <P,>(_kind: string, _label: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) =>
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
  db: { apiKey: { updateMany: vi.fn() } },
}));

import { db } from "@/lib/db";
import { DELETE } from "@/app/api/v1/keys/[id]/route";

const mockedUpdate = db.apiKey.updateMany as ReturnType<typeof vi.fn>;

function makeReq(): NextRequest {
  return new Request("http://localhost/api/v1/keys/k1", {
    method: "DELETE",
    headers: { origin: "http://localhost" },
  }) as unknown as NextRequest;
}

beforeEach(() => mockedUpdate.mockReset());
afterEach(() => vi.clearAllMocks());

describe("DELETE /api/v1/keys/[id]", () => {
  it("returns 404 when no live row matched", async () => {
    mockedUpdate.mockResolvedValueOnce({ count: 0 });
    const res = await DELETE(makeReq(), { params: Promise.resolve({ id: "k1" }) });
    expect(res.status).toBe(404);
  });

  it("revokes the key scoped to the user (revokedAt: null filter)", async () => {
    mockedUpdate.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE(makeReq(), { params: Promise.resolve({ id: "k1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(1);
    expect(mockedUpdate.mock.calls[0][0].where).toEqual({ id: "k1", userId: "u1", revokedAt: null });
    expect(mockedUpdate.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
  });
});
