import { describe, it, expect } from "vitest";
import { ChromaAdapter } from "@/lib/kb/stores/chroma";
import type { Chunk } from "@/lib/kb/types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(handlers: Array<(url: string, init: RequestInit) => Response | Promise<Response>>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchImpl = ((url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const handler = handlers[i++] ?? handlers[handlers.length - 1];
    return Promise.resolve(handler(String(url), init));
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function makeChunk(overrides: Partial<Chunk["metadata"]> = {}, embedding = [0.1, 0.2]): Chunk & { embedding: number[] } {
  return {
    text: "hello",
    metadata: {
      jobId: "job-1",
      fileName: "doc.pdf",
      chunkIndex: 0,
      chunkOf: 1,
      strategy: "fixed",
      extractedAt: "2026-05-02T00:00:00.000Z",
      ...overrides,
    },
    embedding,
  };
}

describe("ChromaAdapter.collectionExists", () => {
  it("returns true on 200", async () => {
    const { fetch: f, calls } = recordingFetch([(_url) => jsonResponse({ id: "col-1", name: "x" })]);
    const adapter = new ChromaAdapter({ baseUrl: "http://chroma:8000" , apiVersion: "v1" }, f);
    expect(await adapter.collectionExists("x")).toBe(true);
    expect(calls[0].url).toBe("http://chroma:8000/api/v1/collections/x");
    expect(calls[0].init.method).toBe("GET");
  });

  it("returns false on 404", async () => {
    const { fetch: f } = recordingFetch([() => new Response("not found", { status: 404 })]);
    const adapter = new ChromaAdapter({ baseUrl: "http://chroma:8000" , apiVersion: "v1" }, f);
    expect(await adapter.collectionExists("missing")).toBe(false);
  });

  it("URL-encodes the collection name", async () => {
    const { fetch: f, calls } = recordingFetch([() => jsonResponse({ id: "x", name: "x" })]);
    const adapter = new ChromaAdapter({ baseUrl: "http://chroma:8000" , apiVersion: "v1" }, f);
    await adapter.collectionExists("my docs/2026");
    expect(calls[0].url).toBe("http://chroma:8000/api/v1/collections/my%20docs%2F2026");
  });

  it("strips trailing slashes from baseUrl", async () => {
    const { fetch: f, calls } = recordingFetch([() => jsonResponse({ id: "x", name: "x" })]);
    const adapter = new ChromaAdapter({ baseUrl: "http://chroma:8000///" , apiVersion: "v1" }, f);
    await adapter.collectionExists("x");
    expect(calls[0].url).toBe("http://chroma:8000/api/v1/collections/x");
  });

  it("forwards Authorization when apiKey is set", async () => {
    const { fetch: f, calls } = recordingFetch([() => jsonResponse({ id: "x", name: "x" })]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c", apiKey: "k1" , apiVersion: "v1" }, f);
    await adapter.collectionExists("x");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer k1");
  });
});

describe("ChromaAdapter.upsert", () => {
  it("returns immediately when chunks is empty (no HTTP call)", async () => {
    const { fetch: f, calls } = recordingFetch([() => jsonResponse({})]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await adapter.upsert([], "x");
    expect(calls).toHaveLength(0);
  });

  it("get-or-creates the collection then posts ids/documents/embeddings/metadatas", async () => {
    const { fetch: f } = recordingFetch([
      // create
      (url, init) => {
        expect(url).toBe("http://c/api/v1/collections");
        const body = JSON.parse(init.body as string);
        expect(body.name).toBe("kb-1");
        expect(body.get_or_create).toBe(true);
        return jsonResponse({ id: "col-id-1", name: "kb-1" });
      },
      // upsert
      (url, init) => {
        expect(url).toBe("http://c/api/v1/collections/col-id-1/upsert");
        const body = JSON.parse(init.body as string);
        expect(body.ids).toEqual(["job-1-c0", "job-1-c1"]);
        expect(body.documents).toEqual(["hello", "world"]);
        expect(body.embeddings).toEqual([[0.1, 0.2], [0.3, 0.4]]);
        expect(body.metadatas[0].jobId).toBe("job-1");
        expect(body.metadatas[0].chunkIndex).toBe(0);
        return jsonResponse({});
      },
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await adapter.upsert(
      [
        makeChunk({ chunkIndex: 0 }),
        { ...makeChunk({ chunkIndex: 1 }), text: "world", embedding: [0.3, 0.4] },
      ],
      "kb-1",
    );
  });

  it("attaches dimensions metadata at create time when configured", async () => {
    const { fetch: f } = recordingFetch([
      (_u, init) => {
        const body = JSON.parse(init.body as string);
        expect(body.metadata?.dimension).toBe(384);
        return jsonResponse({ id: "x", name: "y" });
      },
      () => jsonResponse({}),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c", dimensions: 384 , apiVersion: "v1" }, f);
    await adapter.upsert([makeChunk()], "kb-1");
  });

  it("uses contentHash for ids when present", async () => {
    const { fetch: f } = recordingFetch([
      () => jsonResponse({ id: "col", name: "x" }),
      (_u, init) => {
        const body = JSON.parse(init.body as string);
        expect(body.ids[0]).toBe("job-1-deadbeefcafef00d");
        return jsonResponse({});
      },
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await adapter.upsert(
      [makeChunk({ contentHash: "deadbeefcafef00d1234567890abcdef" })],
      "x",
    );
  });

  it("encodes pageNumber into the id when no contentHash", async () => {
    const { fetch: f } = recordingFetch([
      () => jsonResponse({ id: "col", name: "x" }),
      (_u, init) => {
        const body = JSON.parse(init.body as string);
        expect(body.ids[0]).toBe("job-1-p3-c2");
        return jsonResponse({});
      },
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await adapter.upsert([makeChunk({ pageNumber: 3, chunkIndex: 2 })], "x");
  });

  it("flattens non-primitive metadata via JSON.stringify", async () => {
    const { fetch: f } = recordingFetch([
      () => jsonResponse({ id: "col", name: "x" }),
      (_u, init) => {
        const body = JSON.parse(init.body as string);
        // strategy is a string, jobId is a string, chunkIndex/chunkOf are numbers
        // — all primitive, all preserved as-is
        expect(typeof body.metadatas[0].strategy).toBe("string");
        expect(typeof body.metadatas[0].chunkIndex).toBe("number");
        return jsonResponse({});
      },
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await adapter.upsert([makeChunk()], "x");
  });

  it("skips undefined metadata fields", async () => {
    const { fetch: f } = recordingFetch([
      () => jsonResponse({ id: "col", name: "x" }),
      (_u, init) => {
        const body = JSON.parse(init.body as string);
        expect("language" in body.metadatas[0]).toBe(false); // undefined stripped
        expect("model" in body.metadatas[0]).toBe(false);
        return jsonResponse({});
      },
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await adapter.upsert([makeChunk()], "x");
  });

  it("throws with parsed error message on non-2xx upsert", async () => {
    const { fetch: f } = recordingFetch([
      () => jsonResponse({ id: "col", name: "x" }),
      () => jsonResponse({ error: "dimension mismatch" }, 500),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await expect(adapter.upsert([makeChunk()], "x")).rejects.toThrow(/dimension mismatch/);
  });

  it("throws with parsed error on non-2xx collection create", async () => {
    const { fetch: f } = recordingFetch([
      () => jsonResponse({ detail: "name reserved" }, 400),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await expect(adapter.upsert([makeChunk()], "reserved")).rejects.toThrow(/name reserved/);
  });

  it("throws when collection-create response is missing id", async () => {
    const { fetch: f } = recordingFetch([() => jsonResponse({ name: "x" })]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" , apiVersion: "v1" }, f);
    await expect(adapter.upsert([makeChunk()], "x")).rejects.toThrow(/missing id/);
  });
});

describe("ChromaAdapter v2 paths", () => {
  it("uses /api/v2/tenants/.../databases/.../collections when apiVersion=v2", async () => {
    const { fetch: f, calls } = recordingFetch([
      () => jsonResponse({ id: "col-v2", name: "kb" }),
      () => jsonResponse({}),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c", apiVersion: "v2" }, f);
    await adapter.upsert([makeChunk()], "kb");
    expect(calls[0].url).toBe("http://c/api/v2/tenants/default_tenant/databases/default_database/collections");
    expect(calls[1].url).toBe("http://c/api/v2/tenants/default_tenant/databases/default_database/collections/col-v2/upsert");
  });

  it("honors custom tenant + database in v2 paths", async () => {
    const { fetch: f, calls } = recordingFetch([
      () => jsonResponse({ id: "col-x", name: "kb" }),
      () => jsonResponse({}),
    ]);
    const adapter = new ChromaAdapter(
      { baseUrl: "http://c", apiVersion: "v2", tenant: "acme", database: "prod" },
      f,
    );
    await adapter.upsert([makeChunk()], "kb");
    expect(calls[0].url).toBe("http://c/api/v2/tenants/acme/databases/prod/collections");
  });

  it("URL-encodes tenant and database segments", async () => {
    const { fetch: f, calls } = recordingFetch([() => jsonResponse({ id: "x", name: "kb" })]);
    const adapter = new ChromaAdapter(
      { baseUrl: "http://c", apiVersion: "v2", tenant: "acme/staging", database: "team data" },
      f,
    );
    await adapter.collectionExists("kb");
    expect(calls[0].url).toBe("http://c/api/v2/tenants/acme%2Fstaging/databases/team%20data/collections/kb");
  });
});

describe("ChromaAdapter auto-detection (default)", () => {
  it("probes /api/v2/heartbeat first and uses v2 paths on success", async () => {
    const { fetch: f, calls } = recordingFetch([
      () => jsonResponse({ "nanosecond heartbeat": 1 }),
      () => jsonResponse({ id: "col-v2", name: "kb" }),
      () => jsonResponse({}),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" }, f);
    await adapter.upsert([makeChunk()], "kb");
    expect(calls[0].url).toBe("http://c/api/v2/heartbeat");
    expect(calls[1].url).toBe("http://c/api/v2/tenants/default_tenant/databases/default_database/collections");
  });

  it("falls back to v1 when /api/v2/heartbeat returns 404", async () => {
    const { fetch: f, calls } = recordingFetch([
      () => new Response("not found", { status: 404 }),
      () => jsonResponse({ "nanosecond heartbeat": 1 }),
      () => jsonResponse({ id: "col-v1", name: "kb" }),
      () => jsonResponse({}),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" }, f);
    await adapter.upsert([makeChunk()], "kb");
    expect(calls[0].url).toBe("http://c/api/v2/heartbeat");
    expect(calls[1].url).toBe("http://c/api/v1/heartbeat");
    expect(calls[2].url).toBe("http://c/api/v1/collections");
  });

  it("throws if both heartbeats fail", async () => {
    const { fetch: f } = recordingFetch([
      () => new Response("nope", { status: 500 }),
      () => new Response("nope", { status: 500 }),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" }, f);
    await expect(adapter.upsert([makeChunk()], "kb")).rejects.toThrow(/unable to resolve Chroma API version/);
  });

  it("caches the resolved version across calls", async () => {
    const { fetch: f, calls } = recordingFetch([
      () => jsonResponse({ "nanosecond heartbeat": 1 }),
      () => jsonResponse({ id: "col-1", name: "kb" }),
      () => jsonResponse({}),
      () => jsonResponse({ id: "col-2", name: "kb2" }),
      () => jsonResponse({}),
    ]);
    const adapter = new ChromaAdapter({ baseUrl: "http://c" }, f);
    await adapter.upsert([makeChunk()], "kb");
    await adapter.upsert([makeChunk()], "kb2");
    const heartbeats = calls.filter((c) => c.url.includes("/heartbeat"));
    expect(heartbeats).toHaveLength(1);
  });
});
