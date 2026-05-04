import { describe, it, expect } from "vitest";

import { PineconeAdapter } from "@/lib/kb/stores/pinecone";
import type { Chunk } from "@/lib/kb/types";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string | URL, init: RequestInit = {}) =>
    Promise.resolve(handler(String(url), init))) as typeof fetch;
}

function chunk(text: string, index: number): Chunk & { embedding: number[] } {
  return {
    text,
    embedding: [0.1, 0.2],
    metadata: {
      jobId: "job1",
      fileName: "doc.pdf",
      chunkIndex: index,
      chunkOf: 1,
      strategy: "fixed",
      extractedAt: new Date().toISOString(),
      contentHash: `hash-${index}`,
    },
  };
}

describe("PineconeAdapter", () => {
  it("requires apiKey at construction", () => {
    expect(() => new PineconeAdapter({ baseUrl: "https://idx.svc.region.pinecone.io", apiKey: "" })).toThrow();
  });

  it("collectionExists POSTs /describe_index_stats with Api-Key header", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("https://idx.svc.region.pinecone.io/describe_index_stats");
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Api-Key"]).toBe("k1");
      return new Response("{}", { status: 200 });
    });
    const a = new PineconeAdapter({ baseUrl: "https://idx.svc.region.pinecone.io", apiKey: "k1" }, fetchImpl);
    expect(await a.collectionExists("ignored")).toBe(true);
  });

  it("upsert sends vectors with correct shape and namespace", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("https://idx.svc.region.pinecone.io/vectors/upsert");
      const body = JSON.parse(init.body as string);
      expect(body.namespace).toBe("kb1");
      expect(body.vectors).toHaveLength(2);
      expect(body.vectors[0].id).toBe("job1:hash-0");
      expect(body.vectors[0].values).toEqual([0.1, 0.2]);
      expect(body.vectors[0].metadata.text).toBe("a");
      return new Response("{}", { status: 200 });
    });
    const a = new PineconeAdapter({ baseUrl: "https://idx.svc.region.pinecone.io", apiKey: "k1" }, fetchImpl);
    await a.upsert([chunk("a", 0), chunk("b", 1)], "kb1");
  });

  it("upsert filters out non-scalar metadata to satisfy Pinecone constraints", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const body = JSON.parse(init.body as string);
      const md = body.vectors[0].metadata;
      expect(md.text).toBe("a");
      expect(md.fileName).toBe("doc.pdf");
      expect(md.headingPath).toBeUndefined();
      return new Response("{}", { status: 200 });
    });
    const a = new PineconeAdapter({ baseUrl: "https://idx.svc.region.pinecone.io", apiKey: "k1" }, fetchImpl);
    const c = chunk("a", 0);
    (c.metadata as unknown as Record<string, unknown>).headingPath = { nested: "object" };
    await a.upsert([c], "kb1");
  });

  it("throws on non-2xx upsert", async () => {
    const fetchImpl = mockFetch(() => new Response(JSON.stringify({ message: "bad index" }), { status: 404 }));
    const a = new PineconeAdapter({ baseUrl: "https://idx.svc.region.pinecone.io", apiKey: "k1" }, fetchImpl);
    await expect(a.upsert([chunk("a", 0)], "kb1")).rejects.toThrow(/bad index/);
  });
});
