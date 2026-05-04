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
    ocrJob: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/ocr/result-store", () => ({
  deleteResultArtifacts: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { GET, PATCH } from "@/app/api/jobs/[id]/pages/[pageNumber]/route";

const mockedFind = db.ocrJob.findFirst as ReturnType<typeof vi.fn>;
const mockedUpdate = db.ocrJob.update as ReturnType<typeof vi.fn>;

const makeReq = (init?: RequestInit) =>
  new Request("http://localhost/api/jobs/j1/pages/2", {
    headers: { origin: "http://localhost", "Content-Type": "application/json" },
    ...init,
  }) as unknown as NextRequest;

beforeEach(() => {
  mockedFind.mockReset();
  mockedUpdate.mockReset();
});
afterEach(() => vi.clearAllMocks());

const buildBaseMeta = () => ({
  pageRecords: [
    { pageNumber: 1, text: "Page one." },
    { pageNumber: 2, text: "Original page two." },
  ],
});

describe("PATCH /api/jobs/[id]/pages/[pageNumber]", () => {
  it("rejects non-string text", async () => {
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ text: 42 }) }),
      { params: Promise.resolve({ id: "j1", pageNumber: "2" }) },
    );
    expect(res.status).toBe(400);
  });

  it("rejects when job not found in caller's scope", async () => {
    mockedFind.mockResolvedValueOnce(null);
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ text: "new text" }) }),
      { params: Promise.resolve({ id: "j1", pageNumber: "2" }) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects editing a non-COMPLETED job", async () => {
    mockedFind.mockResolvedValueOnce({ id: "j1", status: "PROCESSING", metadata: buildBaseMeta(), extractedTextLocation: null });
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ text: "x" }) }),
      { params: Promise.resolve({ id: "j1", pageNumber: "2" }) },
    );
    expect(res.status).toBe(400);
  });

  it("appends prior text to pageEdits history and re-stitches", async () => {
    mockedFind.mockResolvedValueOnce({ id: "j1", status: "COMPLETED", metadata: buildBaseMeta(), extractedTextLocation: null });
    mockedUpdate.mockResolvedValueOnce({});
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ text: "Edited page two." }) }),
      { params: Promise.resolve({ id: "j1", pageNumber: "2" }) },
    );
    expect(res.status).toBe(200);
    const updateCall = mockedUpdate.mock.calls[0][0];
    expect(updateCall.data.extractedText).toBe("Page one.\n\n---\n\nEdited page two.");
    expect(updateCall.data.userEdited).toBe(true);
    const meta = updateCall.data.metadata as { pageEdits: Record<string, unknown[]>; userEdited: boolean; staleExports: boolean };
    expect(meta.userEdited).toBe(true);
    expect(meta.staleExports).toBe(true);
    expect(meta.pageEdits["2"]).toHaveLength(1);
    expect((meta.pageEdits["2"][0] as { text: string }).text).toBe("Original page two.");
  });

  it("caps history at 20 entries", async () => {
    const huge = Array.from({ length: 25 }, (_, i) => ({
      text: `prior ${i}`,
      editedAt: "2026-01-01T00:00:00Z",
      characterCount: 7,
    }));
    mockedFind.mockResolvedValueOnce({
      id: "j1",
      status: "COMPLETED",
      metadata: { ...buildBaseMeta(), pageEdits: { "2": huge } },
      extractedTextLocation: null,
    });
    mockedUpdate.mockResolvedValueOnce({});
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ text: "newest" }) }),
      { params: Promise.resolve({ id: "j1", pageNumber: "2" }) },
    );
    expect(res.status).toBe(200);
    const meta = mockedUpdate.mock.calls[0][0].data.metadata as { pageEdits: Record<string, unknown[]> };
    expect(meta.pageEdits["2"]).toHaveLength(20);
    expect((meta.pageEdits["2"][0] as { text: string }).text).toBe("Original page two.");
  });

  it("truncates a 100KB prior page to 32KB in the history but preserves characterCount", async () => {
    const longText = "x".repeat(100_000);
    mockedFind.mockResolvedValueOnce({
      id: "j1",
      status: "COMPLETED",
      metadata: {
        pageRecords: [
          { pageNumber: 1, text: "short" },
          { pageNumber: 2, text: longText },
        ],
      },
      extractedTextLocation: null,
    });
    mockedUpdate.mockResolvedValueOnce({});
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ text: "now short" }) }),
      { params: Promise.resolve({ id: "j1", pageNumber: "2" }) },
    );
    expect(res.status).toBe(200);
    const meta = mockedUpdate.mock.calls[0][0].data.metadata as { pageEdits: Record<string, unknown[]> };
    const entry = meta.pageEdits["2"][0] as { text: string; characterCount: number; truncated?: boolean };
    expect(entry.text.length).toBe(32_000);
    expect(entry.characterCount).toBe(100_000);
    expect(entry.truncated).toBe(true);
  });

  it("rejects an invalid pageNumber", async () => {
    const res = await PATCH(
      makeReq({ method: "PATCH", body: JSON.stringify({ text: "x" }) }),
      { params: Promise.resolve({ id: "j1", pageNumber: "0" }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/jobs/[id]/pages/[pageNumber]", () => {
  it("returns the history (newest first)", async () => {
    mockedFind.mockResolvedValueOnce({
      id: "j1",
      metadata: {
        pageEdits: {
          "2": [
            { text: "v3", editedAt: "2026-01-03", characterCount: 2 },
            { text: "v2", editedAt: "2026-01-02", characterCount: 2 },
          ],
        },
      },
    });
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "j1", pageNumber: "2" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageNumber).toBe(2);
    expect(body.history).toHaveLength(2);
    expect(body.history[0].text).toBe("v3");
  });

  it("returns an empty history if there have been no edits", async () => {
    mockedFind.mockResolvedValueOnce({ id: "j1", metadata: buildBaseMeta() });
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "j1", pageNumber: "2" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toEqual([]);
  });

  it("returns 404 when the job is not in the caller's scope", async () => {
    mockedFind.mockResolvedValueOnce(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "j1", pageNumber: "2" }) });
    expect(res.status).toBe(404);
  });
});
