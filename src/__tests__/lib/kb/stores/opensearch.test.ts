import { describe, it, expect } from "vitest";

import { OpenSearchAdapter } from "@/lib/kb/stores/opensearch";
import type { Chunk } from "@/lib/kb/types";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string | URL, init: RequestInit = {}) =>
    Promise.resolve(handler(String(url), init))) as typeof fetch;
}

function chunk(text: string, index: number): Chunk & { embedding: number[] } {
  return {
    text,
    embedding: [0.1, 0.2, 0.3],
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

describe("OpenSearchAdapter", () => {
  it("collectionExists uses HEAD on the index path", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://os/my-index");
      expect(init.method).toBe("HEAD");
      return new Response("", { status: 200 });
    });
    const a = new OpenSearchAdapter({ baseUrl: "http://os" }, fetchImpl);
    expect(await a.collectionExists("my-index")).toBe(true);
  });

  it("upsert creates index when missing, then bulk-inserts NDJSON", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, method: init.method as string, body: init.body as string | undefined });
      if (init.method === "HEAD") return new Response("", { status: 404 });
      if (init.method === "PUT") return new Response("{}", { status: 200 });
      if (init.method === "POST") return new Response(JSON.stringify({ errors: false, items: [] }), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    const a = new OpenSearchAdapter({ baseUrl: "http://os" }, fetchImpl);
    await a.upsert([chunk("a", 0), chunk("b", 1)], "kb1");
    expect(calls[0]).toMatchObject({ url: "http://os/kb1", method: "HEAD" });
    expect(calls[1]).toMatchObject({ url: "http://os/kb1", method: "PUT" });
    expect(calls[2]).toMatchObject({ url: "http://os/_bulk", method: "POST" });
    const ndjson = calls[2].body as string;
    const lines = ndjson.split("\n").filter(Boolean);
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0])).toEqual({ index: { _index: "kb1", _id: "job1:hash-0" } });
    expect(JSON.parse(lines[1]).vector).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws when bulk reports errors=true", async () => {
    const fetchImpl = mockFetch((url, init) => {
      if (init.method === "HEAD") return new Response("", { status: 200 });
      return new Response(JSON.stringify({ errors: true, items: [{}] }), { status: 200 });
    });
    const a = new OpenSearchAdapter({ baseUrl: "http://os" }, fetchImpl);
    await expect(a.upsert([chunk("a", 0)], "kb1")).rejects.toThrow(/bulk reported errors/);
  });

  it("supports basic auth fallback when apiKey is not set", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      expect(auth?.startsWith("Basic ")).toBe(true);
      return new Response("", { status: 200 });
    });
    const a = new OpenSearchAdapter({ baseUrl: "http://os", basicAuth: "user:pass" }, fetchImpl);
    await a.collectionExists("c");
  });
});
