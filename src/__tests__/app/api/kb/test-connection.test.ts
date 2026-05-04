import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/request", () => ({
  withMutationAuth: <P,>(_scope: string, handler: (req: NextRequest, ctx: { auth: unknown; params: Promise<P> }) => Promise<Response>) => {
    return async (req: NextRequest) => {
      try {
        return await handler(req, {
          auth: { method: "session", userId: "user-1", scopes: ["*"] },
          params: Promise.resolve({} as P),
        });
      } catch (error) {
        if (error instanceof Error && "status" in error) {
          const status = (error as { status?: number }).status ?? 500;
          return new Response(JSON.stringify({ error: error.message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    };
  },
}));

vi.mock("@/lib/kb/defaults-store", () => ({
  getKbDefaults: vi.fn(),
}));

vi.mock("@/lib/kb/stores/test-connection", () => ({
  testVectorStoreConnection: vi.fn(),
}));

import { getKbDefaults } from "@/lib/kb/defaults-store";
import { testVectorStoreConnection } from "@/lib/kb/stores/test-connection";
import { POST as browserPost } from "@/app/api/kb/test-connection/route";
import { POST as v1Post } from "@/app/api/v1/kb/test-connection/route";

const mockedDefaults = getKbDefaults as ReturnType<typeof vi.fn>;
const mockedProbe = testVectorStoreConnection as ReturnType<typeof vi.fn>;

function makeRequest(body: unknown): NextRequest {
  return new Request("http://localhost/api/kb/test-connection", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  process.env.VECTOR_STORE_ALLOWED_HOSTS = "qdrant.test,chroma.test,weaviate.test";
  mockedProbe.mockReset().mockResolvedValue({
    ok: true,
    latencyMs: 12,
    endpoint: "/v1/schema",
    version: "1.0",
    status: 200,
  });
  mockedDefaults.mockReset().mockResolvedValue({
    embedding: { provider: "ollama", apiEndpoint: "x", apiKey: "", model: "m" },
    chunking: { strategy: "paragraph", maxChunkSize: 1200 },
    vectorStore: { kind: "weaviate", baseUrl: "http://weaviate.test:8080", apiKey: "stored-secret" },
    collectionNameTemplate: "extracto-{jobId}",
  });
});

afterEach(() => {
  delete process.env.VECTOR_STORE_ALLOWED_HOSTS;
  vi.clearAllMocks();
});

describe.each([
  { label: "browser route", post: browserPost },
  { label: "v1 route", post: v1Post },
])("$label", ({ post }) => {
  it("rejects unknown kind", async () => {
    const resp = await post(makeRequest({ kind: "totally-unknown", baseUrl: "http://chroma.test" }));
    expect(resp.status).toBe(400);
  });

  it("accepts every supported kind through validation", async () => {
    for (const kind of ["chroma", "qdrant", "weaviate", "milvus", "opensearch", "pinecone", "typesense"]) {
      mockedProbe.mockResolvedValueOnce({ ok: true, latencyMs: 1, endpoint: "/x", status: 200 });
      const resp = await post(makeRequest({ kind, baseUrl: "http://chroma.test" }));
      expect(resp.status, `kind=${kind}`).toBe(200);
    }
  });

  it("rejects missing baseUrl", async () => {
    const resp = await post(makeRequest({ kind: "chroma" }));
    expect(resp.status).toBe(400);
  });

  it("rejects baseUrl outside the allowlist", async () => {
    const resp = await post(makeRequest({ kind: "chroma", baseUrl: "http://evil.example.com" }));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/not allowed/);
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it("rejects cloud-metadata addresses regardless of allowlist", async () => {
    process.env.VECTOR_STORE_ALLOWED_HOSTS = "169.254.169.254";
    const resp = await post(makeRequest({ kind: "chroma", baseUrl: "http://169.254.169.254/" }));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/blocked/);
    expect(mockedProbe).not.toHaveBeenCalled();
  });

  it("rejects ftp scheme", async () => {
    const resp = await post(makeRequest({ kind: "chroma", baseUrl: "ftp://chroma.test" }));
    expect(resp.status).toBe(400);
  });

  it("uses the apiKey from the request body when present", async () => {
    const resp = await post(makeRequest({ kind: "chroma", baseUrl: "http://chroma.test", apiKey: "from-body" }));
    expect(resp.status).toBe(200);
    const calls = mockedProbe.mock.calls;
    expect(calls[0][0]).toMatchObject({ kind: "chroma", apiKey: "from-body" });
  });

  it("does not inject the stored apiKey when the field is present-and-empty", async () => {
    await post(makeRequest({ kind: "weaviate", baseUrl: "http://weaviate.test:8080", apiKey: "" }));
    expect(mockedProbe).toHaveBeenCalled();
    const arg = mockedProbe.mock.calls[0][0];
    expect(arg.apiKey).toBeUndefined();
    expect(mockedDefaults).not.toHaveBeenCalled();
  });

  it("falls back to the stored apiKey when the field is absent and kind+baseUrl match", async () => {
    await post(makeRequest({ kind: "weaviate", baseUrl: "http://weaviate.test:8080" }));
    expect(mockedDefaults).toHaveBeenCalledWith("user-1");
    const arg = mockedProbe.mock.calls[0][0];
    expect(arg.apiKey).toBe("stored-secret");
  });

  it("does NOT inject the stored apiKey when the kind differs from stored defaults", async () => {
    await post(makeRequest({ kind: "chroma", baseUrl: "http://chroma.test" }));
    const arg = mockedProbe.mock.calls[0][0];
    expect(arg.apiKey).toBeUndefined();
  });

  it("does NOT inject the stored apiKey when baseUrl differs from stored", async () => {
    await post(makeRequest({ kind: "weaviate", baseUrl: "http://weaviate.test:9090" }));
    const arg = mockedProbe.mock.calls[0][0];
    expect(arg.apiKey).toBeUndefined();
  });
});

describe("route parity", () => {
  it("browser and v1 produce equivalent responses for identical inputs", async () => {
    const body = { kind: "chroma" as const, baseUrl: "http://chroma.test", apiKey: "k" };
    const r1 = await browserPost(makeRequest(body));
    const r2 = await v1Post(makeRequest(body));
    expect(r1.status).toBe(r2.status);
    expect(await r1.json()).toEqual(await r2.json());
  });
});
