import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const authMockState = vi.hoisted(() => ({ mutationScope: "" }));

vi.mock("@/lib/auth/request", () => ({
  withMutationAuth: <P,>(scope: string, handler: (req: NextRequest, ctx: { auth: { userId: string }; params: Promise<P> }) => Promise<Response>) => {
    authMockState.mutationScope = scope;
    return async (req: NextRequest, ctx: { params?: Promise<P> } = {}) => {
      try {
        return await handler(req, {
          auth: { userId: "u1" },
          params: ctx.params ?? Promise.resolve({} as P),
        });
      } catch (error) {
        const status = error instanceof Error && "status" in error ? ((error as { status?: number }).status ?? 500) : 500;
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "internal" }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    };
  },
}));

vi.mock("@/lib/db", () => ({
  db: { ocrJob: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/kb/feature-flag", () => ({
  isKbExportEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/kb/export-progress", () => ({
  registerKbExport: vi.fn().mockReturnValue({ exportId: "kb-export-1" }),
  updateKbExport: vi.fn(),
}));

vi.mock("@/lib/kb/export", () => ({
  runKbExport: vi.fn().mockResolvedValue({ chunkCount: 1 }),
}));

vi.mock("@/lib/kb/defaults-store", () => ({
  getKbDefaults: vi.fn().mockResolvedValue({
    embedding: {
      provider: "openai_compat",
      apiEndpoint: "https://api.openai.com/v1",
      apiKey: "sk-test",
      model: "text-embedding-3-small",
      dimensions: 1536,
    },
    chunking: { strategy: "paragraph", maxChunkSize: 1000 },
    vectorStore: {
      kind: "chroma",
      baseUrl: "http://127.0.0.1:8000",
      apiKey: "",
      dimensions: 1536,
    },
    collectionNameTemplate: "extracto-{jobId}",
    embeddingConcurrency: 1,
  }),
  renderCollectionName: vi.fn().mockReturnValue("extracto-j1"),
}));

vi.mock("@/lib/ocr/endpoint-policy", () => ({
  enforceProviderEndpointPolicy: vi.fn((_provider: string, endpoint: string) => endpoint),
  enforceVectorStoreEndpointPolicy: vi.fn((endpoint: string) => endpoint.replace(/\/+$/u, "")),
}));

vi.mock("@/lib/ocr/result-store", () => ({
  readResultText: vi.fn((_location: string | null | undefined, inline: string | null | undefined) =>
    Promise.resolve(inline ?? null)
  ),
}));

vi.mock("@/lib/kb/stores/chroma", () => ({ ChromaAdapter: vi.fn().mockImplementation(function () {}) }));
vi.mock("@/lib/kb/stores/qdrant", () => ({ QdrantAdapter: vi.fn().mockImplementation(function () {}) }));
vi.mock("@/lib/kb/stores/weaviate", () => ({ WeaviateAdapter: vi.fn().mockImplementation(function () {}) }));
vi.mock("@/lib/kb/stores/milvus", () => ({ MilvusAdapter: vi.fn().mockImplementation(function () {}) }));
vi.mock("@/lib/kb/stores/opensearch", () => ({ OpenSearchAdapter: vi.fn().mockImplementation(function () {}) }));
vi.mock("@/lib/kb/stores/pinecone", () => ({ PineconeAdapter: vi.fn().mockImplementation(function () {}) }));
vi.mock("@/lib/kb/stores/typesense", () => ({ TypesenseAdapter: vi.fn().mockImplementation(function () {}) }));

import { db } from "@/lib/db";
import { runKbExport } from "@/lib/kb/export";
import { readResultText } from "@/lib/ocr/result-store";
import { POST } from "@/app/api/kb/export/route";

const mockedFindFirst = db.ocrJob.findFirst as ReturnType<typeof vi.fn>;
const mockedExport = runKbExport as ReturnType<typeof vi.fn>;
const mockedReadResultText = readResultText as ReturnType<typeof vi.fn>;

function makeReq(body: unknown): NextRequest {
  return new Request("http://localhost/api/kb/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  mockedFindFirst.mockReset();
  mockedExport.mockClear().mockResolvedValue({ chunkCount: 1 });
  mockedReadResultText.mockReset().mockImplementation((_location: string | null | undefined, inline: string | null | undefined) =>
    Promise.resolve(inline ?? null)
  );
});

describe("POST /api/kb/export", () => {
  it("requires the write-capable KB scope", () => {
    expect(authMockState.mutationScope).toBe("kb:write");
  });

  it("uses offloaded extracted text when inline text is empty", async () => {
    mockedFindFirst.mockResolvedValueOnce({
      id: "j1",
      fileName: "doc.pdf",
      extractedText: null,
      extractedTextLocation: "s3://bucket/jobs/j1/extracted-text.txt",
      model: "qwen",
      completedAt: new Date("2026-05-04T12:00:00Z"),
      createdAt: new Date("2026-05-04T11:59:00Z"),
      metadata: {},
    });
    mockedReadResultText.mockResolvedValueOnce("remote text");

    const res = await POST(makeReq({ jobId: "j1" }));

    expect(res.status).toBe(202);
    expect(mockedReadResultText).toHaveBeenCalledWith("s3://bucket/jobs/j1/extracted-text.txt", null);
    expect(mockedExport.mock.calls[0][0].extractedText).toBe("remote text");
  });
});
