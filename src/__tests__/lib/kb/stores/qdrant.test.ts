import { describe, it, expect } from "vitest";
import { QdrantAdapter } from "@/lib/kb/stores/qdrant";
import type { Chunk } from "@/lib/kb/types";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string | URL, init: RequestInit = {}) => Promise.resolve(handler(String(url), init))) as typeof fetch;
}

function chunk(text: string, index: number, jobId = "job1", contentHash?: string): Chunk & { embedding: number[] } {
  return {
    text,
    embedding: [0.1 * (index + 1), 0.2 * (index + 1)],
    metadata: {
      jobId,
      fileName: "doc.pdf",
      chunkIndex: index,
      chunkOf: 1,
      strategy: "fixed",
      extractedAt: new Date().toISOString(),
      contentHash,
    },
  };
}

describe("QdrantAdapter.collectionExists", () => {
  it("returns true when collection GET responds 200", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://q/collections/my-coll");
      return new Response("{}", { status: 200 });
    });
    const a = new QdrantAdapter({ baseUrl: "http://q" }, fetchImpl);
    expect(await a.collectionExists("my-coll")).toBe(true);
  });

  it("returns false when collection GET responds 404", async () => {
    const fetchImpl = mockFetch(() => new Response("not found", { status: 404 }));
    const a = new QdrantAdapter({ baseUrl: "http://q" }, fetchImpl);
    expect(await a.collectionExists("missing")).toBe(false);
  });

  it("strips trailing slashes from baseUrl", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://q/collections/x");
      return new Response("{}", { status: 200 });
    });
    await new QdrantAdapter({ baseUrl: "http://q///" }, fetchImpl).collectionExists("x");
  });
});

describe("QdrantAdapter.upsert", () => {
  it("returns early when chunks is empty without making any HTTP call", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => { calls++; return new Response("{}", { status: 200 }); });
    await new QdrantAdapter({ baseUrl: "http://q" }, fetchImpl).upsert([], "x");
    expect(calls).toBe(0);
  });

  it("creates the collection then upserts points with deterministic UUIDs from contentHash", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fetchImpl = mockFetch((url, init) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body });
      if (init.method === "GET") return new Response("not found", { status: 404 });
      if (url.endsWith("/collections/my")) return new Response("{}", { status: 200 });
      return new Response('{"status":"ok"}', { status: 200 });
    });
    const a = new QdrantAdapter({ baseUrl: "http://q", dimensions: 4, distance: "Dot" }, fetchImpl);
    await a.upsert([chunk("hello", 0, "job1", "deadbeef".repeat(8))], "my");
    expect(calls.find((c) => c.method === "GET" && c.url === "http://q/collections/my")).toBeDefined();
    const create = calls.find((c) => c.method === "PUT" && c.url === "http://q/collections/my");
    expect(create?.body).toEqual({ vectors: { size: 4, distance: "Dot" } });
    const upsert = calls.find((c) => c.url.includes("/points?wait=true"));
    expect(upsert?.method).toBe("PUT");
    const points = (upsert!.body as { points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> }).points;
    expect(points).toHaveLength(1);
    expect(points[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(points[0].vector).toEqual([0.1, 0.2]);
    expect(points[0].payload.text).toBe("hello");
    expect(points[0].payload.jobId).toBe("job1");
  });

  it("skips collection create when it already exists", async () => {
    let creates = 0;
    const fetchImpl = mockFetch((url, init) => {
      if (init.method === "GET") return new Response("{}", { status: 200 });
      if (init.method === "PUT" && url.endsWith("/collections/exists")) {
        creates++;
        return new Response("{}", { status: 200 });
      }
      return new Response('{"status":"ok"}', { status: 200 });
    });
    await new QdrantAdapter({ baseUrl: "http://q" }, fetchImpl).upsert([chunk("a", 0)], "exists");
    expect(creates).toBe(0);
  });

  it("falls back to chunkIndex / pageNumber when no contentHash is set", async () => {
    let upsertBody: { points: Array<{ id: string }> } | null = null;
    const fetchImpl = mockFetch((url, init) => {
      if (init.method === "GET") return new Response("{}", { status: 200 });
      if (url.includes("/points")) {
        upsertBody = JSON.parse(init.body as string);
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const c = chunk("a", 7, "job-x");
    c.metadata.pageNumber = 3;
    await new QdrantAdapter({ baseUrl: "http://q" }, fetchImpl).upsert([c], "x");
    expect(upsertBody!.points[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("throws VectorStoreError on upsert failure with parsed status detail", async () => {
    const fetchImpl = mockFetch((url, init) => {
      if (init.method === "GET") return new Response("{}", { status: 200 });
      if (url.includes("/points")) return new Response('{"status":{"error":"shard down"}}', { status: 500 });
      return new Response("{}", { status: 200 });
    });
    await expect(
      new QdrantAdapter({ baseUrl: "http://q" }, fetchImpl).upsert([chunk("a", 0)], "x"),
    ).rejects.toThrow(/qdrant: upsert failed: shard down/);
  });

  it("sends api-key header when configured", async () => {
    let seenHeader: string | null = null;
    const fetchImpl = mockFetch((_, init) => {
      const h = init.headers as Record<string, string>;
      if (h["api-key"]) seenHeader = h["api-key"];
      if (init.method === "GET") return new Response("{}", { status: 200 });
      return new Response("{}", { status: 200 });
    });
    await new QdrantAdapter({ baseUrl: "http://q", apiKey: "secret-123" }, fetchImpl).upsert([chunk("a", 0)], "x");
    expect(seenHeader).toBe("secret-123");
  });
});
