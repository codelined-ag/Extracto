import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testVectorStoreConnection } from "@/lib/kb/stores/test-connection";

let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("testVectorStoreConnection: validation", () => {
  it("rejects empty baseUrl", async () => {
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/baseUrl/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("rejects baseUrl without http(s) scheme", async () => {
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "ftp://example.com" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/http/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("reports unknown store kind", async () => {
    const result = await testVectorStoreConnection(
      // @ts-expect-error - intentional bad input
      { kind: "pinecone", baseUrl: "http://example.com" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown vector store kind/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("testVectorStoreConnection: chroma", () => {
  it("probes /api/v1/collections (auth-aware) and returns ok on 200", async () => {
    mockedFetch
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ version: "0.4.18" }));
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/api/v1/collections");
    expect(result.status).toBe(200);
    expect(result.version).toBe("0.4.18");
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/collections");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("returns 401 detail when auth is required and key is missing", async () => {
    mockedFetch.mockResolvedValueOnce(
      json({ error: "missing token" }, 401),
    );
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "https://chroma.test" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/401/);
  });

  it("falls back through 404/405/410 to /api/v1/heartbeat", async () => {
    mockedFetch
      .mockResolvedValueOnce(new Response("nope", { status: 405 }))
      .mockResolvedValueOnce(json({ "nanosecond heartbeat": 12345 }));
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/api/v1/heartbeat");
  });

  it("forwards apiKey as Bearer when provided", async () => {
    mockedFetch.mockResolvedValueOnce(json([]));
    await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "https://chroma.test", apiKey: "tok-123" },
      mockedFetch as unknown as typeof fetch,
    );
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("strips trailing slashes from baseUrl", async () => {
    mockedFetch.mockResolvedValueOnce(json([]));
    await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000///" },
      mockedFetch as unknown as typeof fetch,
    );
    const [url] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/collections");
  });
});

describe("testVectorStoreConnection: qdrant", () => {
  it("probes /collections and returns ok on 200", async () => {
    mockedFetch.mockResolvedValueOnce(
      json({ result: { collections: [] }, status: "ok" }),
    );
    const result = await testVectorStoreConnection(
      { kind: "qdrant", baseUrl: "http://qdrant.test:6333" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/collections");
  });

  it("forwards apiKey as the api-key header (not Bearer)", async () => {
    mockedFetch.mockResolvedValueOnce(json({ result: { collections: [] } }));
    await testVectorStoreConnection(
      { kind: "qdrant", baseUrl: "http://qdrant.test:6333", apiKey: "qk-secret" },
      mockedFetch as unknown as typeof fetch,
    );
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("qk-secret");
    expect(headers.Authorization).toBeUndefined();
  });

  it("fetches version from / when /collections succeeds", async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ result: { collections: [] } }))
      .mockResolvedValueOnce(
        json({ title: "qdrant", version: "1.11.4" }),
      );
    const result = await testVectorStoreConnection(
      { kind: "qdrant", baseUrl: "http://qdrant.test:6333" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.version).toBe("1.11.4");
    expect(mockedFetch.mock.calls.length).toBe(2);
  });

  it("returns auth-failure detail on 401", async () => {
    mockedFetch.mockResolvedValueOnce(
      json({ status: { error: "Unauthorized" } }, 401),
    );
    const result = await testVectorStoreConnection(
      { kind: "qdrant", baseUrl: "http://qdrant.test:6333" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/401/);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("testVectorStoreConnection: weaviate", () => {
  it("probes /v1/schema and returns ok on 200", async () => {
    mockedFetch.mockResolvedValueOnce(json({ classes: [] }));
    const result = await testVectorStoreConnection(
      { kind: "weaviate", baseUrl: "http://weaviate.test:8080" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/v1/schema");
  });

  it("falls back to /v1/.well-known/ready on 404", async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ error: "not found" }, 404))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const result = await testVectorStoreConnection(
      { kind: "weaviate", baseUrl: "http://weaviate.test:8080" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/v1/.well-known/ready");
  });

  it("uses Bearer for apiKey", async () => {
    mockedFetch.mockResolvedValueOnce(json({ classes: [] }));
    await testVectorStoreConnection(
      { kind: "weaviate", baseUrl: "http://weaviate.test:8080", apiKey: "wk" },
      mockedFetch as unknown as typeof fetch,
    );
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer wk");
  });

  it("fetches version from /v1/meta when /v1/schema succeeds", async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ classes: [] }))
      .mockResolvedValueOnce(json({ version: "1.27.0" }));
    const result = await testVectorStoreConnection(
      { kind: "weaviate", baseUrl: "http://weaviate.test:8080" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.version).toBe("1.27.0");
  });
});

describe("testVectorStoreConnection: errors and edge cases", () => {
  it("returns a friendly message on network error", async () => {
    mockedFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:9999" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it("returns a friendly message on AbortError (timeout)", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockedFetch.mockRejectedValueOnce(abortErr);
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Timed out/);
  });

  it("includes a body excerpt when 5xx body is non-JSON", async () => {
    mockedFetch.mockResolvedValueOnce(
      new Response("upstream is down", { status: 502 }),
    );
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/502/);
    expect(result.error).toMatch(/upstream is down/);
  });

  it("strips control characters from body excerpts", async () => {
    const noisy = "err" + String.fromCharCode(0, 1, 7, 31) + "binaryjunk";
    mockedFetch.mockResolvedValueOnce(
      new Response(noisy, { status: 500 }),
    );
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/[\u0000-\u001f\u007f]/u);
    expect(result.error).toMatch(/errbinaryjunk/);
  });

  it("returns ok with no version when 200 body is malformed JSON", async () => {
    mockedFetch
      .mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it("does not throw when extractVersion sees an array or null payload", async () => {
    mockedFetch
      .mockResolvedValueOnce(json([1, 2, 3]))
      .mockResolvedValueOnce(json(null));
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.version).toBeUndefined();
  });

  it("reports per-attempt latency, not the sum across fallbacks", async () => {
    mockedFetch
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(new Response("nope", { status: 404 })), 30);
          }),
      )
      .mockResolvedValueOnce(json([]));
    const result = await testVectorStoreConnection(
      { kind: "weaviate", baseUrl: "http://weaviate.test:8080" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeLessThan(25);
  });
});
