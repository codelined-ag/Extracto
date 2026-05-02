import { describe, it, expect } from "vitest";
import { WeaviateAdapter } from "@/lib/kb/stores/weaviate";
import type { Chunk } from "@/lib/kb/types";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string | URL, init: RequestInit = {}) => Promise.resolve(handler(String(url), init))) as typeof fetch;
}

function chunk(text: string, index: number): Chunk & { embedding: number[] } {
  return {
    text,
    embedding: [0.5, 0.6, 0.7],
    metadata: {
      jobId: "j1",
      fileName: "doc.pdf",
      chunkIndex: index,
      chunkOf: 1,
      strategy: "paragraph",
      extractedAt: new Date().toISOString(),
    },
  };
}

describe("WeaviateAdapter.collectionExists", () => {
  it("class-name-encodes the collection and returns true on 200", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://w/v1/schema/My_doc");
      return new Response("{}", { status: 200 });
    });
    expect(await new WeaviateAdapter({ baseUrl: "http://w" }, fetchImpl).collectionExists("my-doc")).toBe(true);
  });

  it("returns false when class is missing (404)", async () => {
    const fetchImpl = mockFetch(() => new Response("not found", { status: 404 }));
    expect(await new WeaviateAdapter({ baseUrl: "http://w" }, fetchImpl).collectionExists("missing")).toBe(false);
  });

  it("prefixes Doc_ when name starts with a non-letter", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://w/v1/schema/Doc_123");
      return new Response("{}", { status: 200 });
    });
    await new WeaviateAdapter({ baseUrl: "http://w" }, fetchImpl).collectionExists("123");
  });
});

describe("WeaviateAdapter.upsert", () => {
  it("returns early when chunks empty", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => { calls++; return new Response("[]", { status: 200 }); });
    await new WeaviateAdapter({ baseUrl: "http://w" }, fetchImpl).upsert([], "x");
    expect(calls).toBe(0);
  });

  it("creates the class when missing then batches objects", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    const fetchImpl = mockFetch((url, init) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body });
      if (init.method === "GET") return new Response("not found", { status: 404 });
      if (url.endsWith("/v1/schema")) return new Response("{}", { status: 200 });
      return new Response("[]", { status: 200 });
    });
    await new WeaviateAdapter({ baseUrl: "http://w", dimensions: 768 }, fetchImpl).upsert([chunk("hi", 0)], "my");
    const create = calls.find((c) => c.method === "POST" && c.url === "http://w/v1/schema");
    expect((create!.body as { class: string }).class).toBe("My");
    const batch = calls.find((c) => c.url === "http://w/v1/batch/objects");
    expect(batch).toBeDefined();
    const objects = (batch!.body as { objects: Array<{ class: string; vector: number[]; properties: Record<string, unknown> }> }).objects;
    expect(objects[0].class).toBe("My");
    expect(objects[0].vector).toEqual([0.5, 0.6, 0.7]);
    expect(objects[0].properties.text).toBe("hi");
  });

  it("throws VectorStoreError when batch HTTP fails", async () => {
    const fetchImpl = mockFetch((_, init) => {
      if (init.method === "GET") return new Response("{}", { status: 200 });
      return new Response('{"error":[{"message":"bad input"}]}', { status: 400 });
    });
    await expect(
      new WeaviateAdapter({ baseUrl: "http://w" }, fetchImpl).upsert([chunk("a", 0)], "c"),
    ).rejects.toThrow(/weaviate: batch_upsert failed: bad input/);
  });

  it("throws when batch returns 200 with per-object errors", async () => {
    const fetchImpl = mockFetch((_, init) => {
      if (init.method === "GET") return new Response("{}", { status: 200 });
      return new Response(
        JSON.stringify([{ result: { errors: { error: [{ message: "type mismatch" }] } } }]),
        { status: 200 },
      );
    });
    await expect(
      new WeaviateAdapter({ baseUrl: "http://w" }, fetchImpl).upsert([chunk("a", 0)], "c"),
    ).rejects.toThrow(/weaviate: batch_upsert partially failed: type mismatch/);
  });

  it("sends Authorization Bearer when apiKey is set", async () => {
    let seen: string | undefined;
    const fetchImpl = mockFetch((_, init) => {
      const h = init.headers as Record<string, string>;
      if (h.Authorization) seen = h.Authorization;
      if (init.method === "GET") return new Response("{}", { status: 200 });
      return new Response("[]", { status: 200 });
    });
    await new WeaviateAdapter({ baseUrl: "http://w", apiKey: "abc" }, fetchImpl).upsert([chunk("a", 0)], "c");
    expect(seen).toBe("Bearer abc");
  });
});
