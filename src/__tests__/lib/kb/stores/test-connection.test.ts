import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testVectorStoreConnection } from "@/lib/kb/stores/test-connection";

let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("testVectorStoreConnection - validation", () => {
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
});

describe("testVectorStoreConnection - chroma", () => {
  it("returns ok on a 200 heartbeat", async () => {
    mockedFetch.mockResolvedValueOnce(json({ "nanosecond heartbeat": 12345 }));
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/api/v1/heartbeat");
    expect(result.status).toBe(200);
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/heartbeat");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("falls back to /api/v1/version when heartbeat returns 404", async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ error: "not found" }, 404))
      .mockResolvedValueOnce(json({ version: "0.4.18" }));
    const result = await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/api/v1/version");
    expect(result.version).toBe("0.4.18");
  });

  it("forwards apiKey as Bearer when provided", async () => {
    mockedFetch.mockResolvedValueOnce(json({ "nanosecond heartbeat": 1 }));
    await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "https://chroma.test", apiKey: "tok-123" },
      mockedFetch as unknown as typeof fetch,
    );
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("strips trailing slashes from baseUrl", async () => {
    mockedFetch.mockResolvedValueOnce(json({}));
    await testVectorStoreConnection(
      { kind: "chroma", baseUrl: "http://localhost:8000///" },
      mockedFetch as unknown as typeof fetch,
    );
    const [url] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/heartbeat");
  });
});

describe("testVectorStoreConnection - qdrant", () => {
  it("returns ok with version on a 200 root", async () => {
    mockedFetch.mockResolvedValueOnce(
      json({ title: "qdrant - vector search engine", version: "1.11.4" }),
    );
    const result = await testVectorStoreConnection(
      { kind: "qdrant", baseUrl: "http://qdrant.test:6333" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.version).toBe("1.11.4");
    expect(result.endpoint).toBe("/");
  });

  it("forwards apiKey as the api-key header (not Bearer)", async () => {
    mockedFetch.mockResolvedValueOnce(json({ version: "1.11.4" }));
    await testVectorStoreConnection(
      { kind: "qdrant", baseUrl: "http://qdrant.test:6333", apiKey: "qk-secret" },
      mockedFetch as unknown as typeof fetch,
    );
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("qk-secret");
    expect(headers.Authorization).toBeUndefined();
  });

  it("returns auth-failure detail on 401 without retrying fallback", async () => {
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

describe("testVectorStoreConnection - weaviate", () => {
  it("returns ok + version on /v1/meta", async () => {
    mockedFetch.mockResolvedValueOnce(json({ version: "1.27.0" }));
    const result = await testVectorStoreConnection(
      { kind: "weaviate", baseUrl: "http://weaviate.test:8080" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    expect(result.version).toBe("1.27.0");
    expect(result.endpoint).toBe("/v1/meta");
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
    mockedFetch.mockResolvedValueOnce(json({ version: "1.27.0" }));
    await testVectorStoreConnection(
      { kind: "weaviate", baseUrl: "http://weaviate.test:8080", apiKey: "wk" },
      mockedFetch as unknown as typeof fetch,
    );
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer wk");
  });
});

describe("testVectorStoreConnection - errors", () => {
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

  it("includes a body excerpt in the error detail when 5xx body is non-JSON", async () => {
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

  it("reports unknown store kind", async () => {
    const result = await testVectorStoreConnection(
      // @ts-expect-error - intentional bad input to verify the guard
      { kind: "pinecone", baseUrl: "http://example.com" },
      mockedFetch as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown vector store kind/);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
