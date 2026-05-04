import { describe, it, expect } from "vitest";

import { MilvusAdapter } from "@/lib/kb/stores/milvus";
import type { Chunk } from "@/lib/kb/types";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string | URL, init: RequestInit = {}) =>
    Promise.resolve(handler(String(url), init))) as typeof fetch;
}

function chunk(text: string, index: number, jobId = "job1"): Chunk & { embedding: number[] } {
  return {
    text,
    embedding: [0.1, 0.2, 0.3],
    metadata: {
      jobId,
      fileName: "doc.pdf",
      chunkIndex: index,
      chunkOf: 1,
      strategy: "fixed",
      extractedAt: new Date().toISOString(),
      contentHash: `hash-${index}`,
    },
  };
}

describe("MilvusAdapter", () => {
  it("collectionExists returns true when has=true", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://m/v2/vectordb/collections/has");
      expect(init.method).toBe("POST");
      return new Response(JSON.stringify({ data: { has: true } }), { status: 200 });
    });
    const a = new MilvusAdapter({ baseUrl: "http://m" }, fetchImpl);
    expect(await a.collectionExists("c")).toBe(true);
  });

  it("collectionExists returns false when has=false", async () => {
    const fetchImpl = mockFetch(() => new Response(JSON.stringify({ data: { has: false } }), { status: 200 }));
    const a = new MilvusAdapter({ baseUrl: "http://m" }, fetchImpl);
    expect(await a.collectionExists("c")).toBe(false);
  });

  it("upsert creates the collection when missing then posts entities", async () => {
    const calls: string[] = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push(url);
      if (url.endsWith("/has")) {
        return new Response(JSON.stringify({ data: { has: false } }), { status: 200 });
      }
      if (url.endsWith("/create")) {
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      if (url.endsWith("/upsert")) {
        const body = JSON.parse(init.body as string);
        expect(body.collectionName).toBe("kb1");
        expect(body.data).toHaveLength(2);
        expect(body.data[0].id).toBe("job1:hash-0");
        expect(body.data[0].vector).toEqual([0.1, 0.2, 0.3]);
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    const a = new MilvusAdapter({ baseUrl: "http://m" }, fetchImpl);
    await a.upsert([chunk("a", 0), chunk("b", 1)], "kb1");
    expect(calls).toEqual([
      "http://m/v2/vectordb/collections/has",
      "http://m/v2/vectordb/collections/create",
      "http://m/v2/vectordb/entities/upsert",
    ]);
  });

  it("upsert throws on non-zero code", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/has")) return new Response(JSON.stringify({ data: { has: true } }), { status: 200 });
      return new Response(JSON.stringify({ code: 7, message: "permission denied" }), { status: 200 });
    });
    const a = new MilvusAdapter({ baseUrl: "http://m" }, fetchImpl);
    await expect(a.upsert([chunk("a", 0)], "kb1")).rejects.toThrow(/permission denied/);
  });

  it("uses Bearer auth when apiKey is set", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      expect(auth).toBe("Bearer secret");
      return new Response(JSON.stringify({ data: { has: true } }), { status: 200 });
    });
    const a = new MilvusAdapter({ baseUrl: "http://m", apiKey: "secret" }, fetchImpl);
    await a.collectionExists("c");
  });
});
