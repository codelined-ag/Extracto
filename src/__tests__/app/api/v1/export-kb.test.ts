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
  db: { ocrJob: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/kb/feature-flag", () => ({
  isKbExportEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/kb/export", () => ({
  runKbExport: vi.fn(),
}));

vi.mock("@/lib/kb/stores/chroma", () => ({ ChromaAdapter: vi.fn() }));
vi.mock("@/lib/kb/stores/qdrant", () => ({ QdrantAdapter: vi.fn() }));
vi.mock("@/lib/kb/stores/weaviate", () => ({ WeaviateAdapter: vi.fn() }));

vi.mock("@/lib/ocr/endpoint-policy", () => ({
  enforceProviderEndpointPolicy: vi.fn().mockImplementation((_p: unknown, host: string) => host),
}));

import { db } from "@/lib/db";
import { isKbExportEnabled } from "@/lib/kb/feature-flag";
import { runKbExport } from "@/lib/kb/export";
import { POST } from "@/app/api/v1/export/kb/route";

const mockedFindFirst = db.ocrJob.findFirst as ReturnType<typeof vi.fn>;
const mockedFlag = isKbExportEnabled as ReturnType<typeof vi.fn>;
const mockedExport = runKbExport as ReturnType<typeof vi.fn>;

function makeReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/v1/export/kb", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const validBody = {
  jobId: "j1",
  collectionName: "docs",
  embedding: { provider: "openai_compat", apiEndpoint: "https://api.openai.com/v1", apiKey: "sk", model: "text-embedding-3-small" },
  vectorStore: { kind: "chroma", baseUrl: "http://localhost:8000" },
  chunking: { strategy: "paragraph", maxChunkSize: 1000 },
};

beforeEach(() => {
  mockedFindFirst.mockReset();
  mockedFlag.mockReset().mockReturnValue(true);
  mockedExport.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("POST /api/v1/export/kb", () => {
  it("returns 503 when KB_EXPORT_ENABLED is unset", async () => {
    mockedFlag.mockReturnValueOnce(false);
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(503);
  });

  it("returns 400 for invalid embedding.provider", async () => {
    const res = await POST(makeReq({ ...validBody, embedding: { ...validBody.embedding, provider: "bogus" } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid chunking.strategy", async () => {
    const res = await POST(makeReq({ ...validBody, chunking: { strategy: "wat", maxChunkSize: 1000 } }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid vectorStore.kind", async () => {
    const res = await POST(makeReq({ ...validBody, vectorStore: { kind: "redis", baseUrl: "http://x" } }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the job is not in the user's scope", async () => {
    mockedFindFirst.mockResolvedValueOnce(null);
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the job has no extracted text", async () => {
    mockedFindFirst.mockResolvedValueOnce({ id: "j1", fileName: "doc", extractedText: "", model: null, completedAt: null, createdAt: new Date(), metadata: {} });
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(400);
  });

  it("dispatches to runKbExport on the happy path", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "j1", fileName: "doc.pdf", extractedText: "hello world",
      model: "qwen", completedAt: new Date(), createdAt: new Date(), metadata: {},
    });
    mockedExport.mockResolvedValueOnce({ jobId: "j1", collectionName: "docs", chunkCount: 3, embeddingDimensions: 1536 });
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    expect(mockedExport).toHaveBeenCalled();
  });

  it("accepts strategy=hierarchical with maxHeadingDepth", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "j1", fileName: "doc.pdf", extractedText: "# H\n\nbody",
      model: "qwen", completedAt: new Date(), createdAt: new Date(), metadata: {},
    });
    mockedExport.mockResolvedValueOnce({ jobId: "j1", collectionName: "docs", chunkCount: 1, embeddingDimensions: 768 });
    const res = await POST(makeReq({
      ...validBody,
      chunking: { strategy: "hierarchical", maxChunkSize: 1000, maxHeadingDepth: 3 },
    }));
    expect(res.status).toBe(200);
    const fwd = mockedExport.mock.calls[0][0];
    expect(fwd.chunking.strategy).toBe("hierarchical");
    expect(fwd.chunking.maxHeadingDepth).toBe(3);
  });

  it("accepts strategy=semantic with breakpointPercentile", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "j1", fileName: "doc.pdf", extractedText: "A. B. C.",
      model: "qwen", completedAt: new Date(), createdAt: new Date(), metadata: {},
    });
    mockedExport.mockResolvedValueOnce({ jobId: "j1", collectionName: "docs", chunkCount: 2, embeddingDimensions: 768 });
    const res = await POST(makeReq({
      ...validBody,
      chunking: { strategy: "semantic", maxChunkSize: 1000, breakpointPercentile: 80 },
    }));
    expect(res.status).toBe(200);
    const fwd = mockedExport.mock.calls[0][0];
    expect(fwd.chunking.strategy).toBe("semantic");
    expect(fwd.chunking.breakpointPercentile).toBe(80);
  });

  it("rejects out-of-range breakpointPercentile", async () => {
    const res = await POST(makeReq({
      ...validBody,
      chunking: { strategy: "semantic", maxChunkSize: 1000, breakpointPercentile: 150 },
    }));
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range maxHeadingDepth", async () => {
    const res = await POST(makeReq({
      ...validBody,
      chunking: { strategy: "hierarchical", maxChunkSize: 1000, maxHeadingDepth: 9 },
    }));
    expect(res.status).toBe(400);
  });
});
