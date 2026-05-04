import { describe, it, expect } from "vitest";

import { TypesenseAdapter } from "@/lib/kb/stores/typesense";
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
      pageNumber: 1,
      chunkIndex: index,
      chunkOf: 2,
      strategy: "fixed",
      extractedAt: new Date().toISOString(),
      contentHash: `h-${index}`,
      language: "en",
    },
  };
}

describe("TypesenseAdapter", () => {
  it("requires apiKey", () => {
    expect(() => new TypesenseAdapter({ baseUrl: "http://127.0.0.1:8108", apiKey: "" })).toThrow();
  });

  it("collectionExists GETs /collections/:name with key header", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8108/collections/kb1");
      expect(init.method).toBe("GET");
      expect((init.headers as Record<string, string>)["X-TYPESENSE-API-KEY"]).toBe("k1");
      return new Response("{}", { status: 200 });
    });
    const a = new TypesenseAdapter({ baseUrl: "http://127.0.0.1:8108", apiKey: "k1" }, fetchImpl);
    expect(await a.collectionExists("kb1")).toBe(true);
  });

  it("upsert auto-creates collection then imports as JSONL with action=upsert", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const fetchImpl = mockFetch((url, init) => {
      calls.push({ url, method: init.method, body: typeof init.body === "string" ? init.body : undefined });
      if (init.method === "GET") return new Response("not found", { status: 404 });
      if (url.endsWith("/collections")) return new Response("{}", { status: 201 });
      return new Response('{"success":true}\n{"success":true}', { status: 200 });
    });
    const a = new TypesenseAdapter({ baseUrl: "http://127.0.0.1:8108", apiKey: "k1", dimensions: 3 }, fetchImpl);
    await a.upsert([chunk("a", 0), chunk("b", 1)], "kb1");

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe("http://127.0.0.1:8108/collections/kb1");
    expect(calls[1].url).toBe("http://127.0.0.1:8108/collections");
    const schema = JSON.parse(calls[1].body!);
    expect(schema.name).toBe("kb1");
    expect(schema.fields.find((f: { name: string }) => f.name === "embedding")).toMatchObject({ type: "float[]", num_dim: 3 });

    expect(calls[2].url).toBe("http://127.0.0.1:8108/collections/kb1/documents/import?action=upsert");
    const lines = calls[2].body!.split("\n");
    expect(lines).toHaveLength(2);
    const doc0 = JSON.parse(lines[0]);
    expect(doc0.id).toBe("job1:h-0");
    expect(doc0.text).toBe("a");
    expect(doc0.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(doc0.fileName).toBe("doc.pdf");
    expect(doc0.language).toBe("en");
  });

  it("surfaces per-doc errors from import response", async () => {
    let call = 0;
    const fetchImpl = mockFetch((_url, init) => {
      call += 1;
      if (init.method === "GET") return new Response("{}", { status: 200 });
      return new Response(
        '{"success":true}\n{"success":false,"error":"vector dim mismatch","document":{"id":"job1:h-1"}}',
        { status: 200 },
      );
    });
    const a = new TypesenseAdapter({ baseUrl: "http://127.0.0.1:8108", apiKey: "k1" }, fetchImpl);
    await expect(a.upsert([chunk("a", 0), chunk("b", 1)], "kb1")).rejects.toThrow(/job1:h-1.*vector dim mismatch/);
    expect(call).toBe(2);
  });

  it("throws on non-2xx import response", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      if (init.method === "GET") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ message: "auth failed" }), { status: 401 });
    });
    const a = new TypesenseAdapter({ baseUrl: "http://127.0.0.1:8108", apiKey: "k1" }, fetchImpl);
    await expect(a.upsert([chunk("a", 0)], "kb1")).rejects.toThrow(/auth failed/);
  });
});
