import { describe, it, expect, vi } from "vitest";
import { embedTexts, EmbeddingError } from "@/lib/kb/embedding";
import type { EmbeddingProviderConfig } from "@/lib/kb/types";

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): typeof fetch {
  return ((url: string | URL, init: RequestInit = {}) => Promise.resolve(handler(String(url), init))) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("embedTexts — empty input", () => {
  it("returns [] for empty texts without making any HTTP call", async () => {
    let calls = 0;
    const fetchImpl = mockFetch(() => { calls++; return jsonResponse({}); });
    const config: EmbeddingProviderConfig = {
      provider: "ollama",
      apiEndpoint: "http://127.0.0.1:11434",
      model: "nomic-embed-text",
    };
    expect(await embedTexts([], config, fetchImpl)).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("embedTexts — Ollama batch path", () => {
  const config: EmbeddingProviderConfig = {
    provider: "ollama",
    apiEndpoint: "http://127.0.0.1:11434",
    model: "nomic-embed-text",
  };

  it("uses /api/embed when available and returns embeddings in order", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:11434/api/embed");
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("nomic-embed-text");
      expect(body.input).toEqual(["a", "b"]);
      return jsonResponse({ embeddings: [[0.1, 0.2], [0.3, 0.4]] });
    });
    expect(await embedTexts(["a", "b"], config, fetchImpl)).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("strips trailing slashes from apiEndpoint", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("http://127.0.0.1:11434/api/embed");
      return jsonResponse({ embeddings: [[0.1]] });
    });
    await embedTexts(["x"], { ...config, apiEndpoint: "http://127.0.0.1:11434//" }, fetchImpl);
  });

  it("throws when batch endpoint returns wrong-length array", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ embeddings: [[0.1]] })); // 1 instead of 2
    await expect(embedTexts(["a", "b"], config, fetchImpl)).rejects.toThrow(EmbeddingError);
    await expect(embedTexts(["a", "b"], config, fetchImpl)).rejects.toThrow(/1 vectors for 2 inputs/);
  });
});

describe("embedTexts — Ollama fallback to /api/embeddings", () => {
  const config: EmbeddingProviderConfig = {
    provider: "ollama",
    apiEndpoint: "http://127.0.0.1:11434",
    model: "old-model",
  };

  it("falls back to /api/embeddings (sequential) when /api/embed is 404", async () => {
    let n = 0;
    const fetchImpl = mockFetch((url, init) => {
      n++;
      if (url.endsWith("/api/embed")) {
        return new Response("not found", { status: 404 });
      }
      expect(url).toBe("http://127.0.0.1:11434/api/embeddings");
      const body = JSON.parse(init.body as string);
      return jsonResponse({ embedding: body.prompt === "first" ? [1, 2] : [3, 4] });
    });
    const result = await embedTexts(["first", "second"], config, fetchImpl);
    expect(result).toEqual([[1, 2], [3, 4]]);
    expect(n).toBe(3); // 1 batch attempt + 2 single calls
  });

  it("throws on non-2xx /api/embeddings response", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/api/embed")) return new Response("", { status: 404 });
      return new Response("model not found", { status: 404, statusText: "Not Found" });
    });
    await expect(embedTexts(["x"], config, fetchImpl)).rejects.toThrow(/404/);
  });

  it("throws when /api/embeddings response lacks 'embedding' field", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/api/embed")) return new Response("", { status: 404 });
      return jsonResponse({ unrelated: true });
    });
    await expect(embedTexts(["x"], config, fetchImpl)).rejects.toThrow(/no 'embedding' field/);
  });
});

describe("embedTexts — OpenAI-compatible path", () => {
  const config: EmbeddingProviderConfig = {
    provider: "openai_compat",
    apiEndpoint: "https://api.openai.com/v1",
    apiKey: "sk-test-123",
    model: "text-embedding-3-small",
  };

  it("posts batch to /embeddings with bearer token", async () => {
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("https://api.openai.com/v1/embeddings");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-test-123");
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.input).toEqual(["a", "b"]);
      return jsonResponse({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
      });
    });
    expect(await embedTexts(["a", "b"], config, fetchImpl)).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("omits Authorization header when no apiKey", async () => {
    const fetchImpl = mockFetch((_url, init) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
      return jsonResponse({ data: [{ embedding: [0.1], index: 0 }] });
    });
    await embedTexts(["x"], { ...config, apiKey: undefined }, fetchImpl);
  });

  it("re-sorts data entries by index defensively", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        data: [
          { embedding: [3, 3], index: 1 },
          { embedding: [1, 1], index: 0 },
        ],
      }),
    );
    expect(await embedTexts(["a", "b"], config, fetchImpl)).toEqual([[1, 1], [3, 3]]);
  });

  it("throws on HTTP error with provider's error.message extracted", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ error: { message: "rate limited" } }, 429),
    );
    await expect(embedTexts(["x"], config, fetchImpl)).rejects.toThrow(/rate limited/);
  });

  it("throws on HTTP error when body isn't JSON", async () => {
    const fetchImpl = mockFetch(() =>
      new Response("server exploded", { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(embedTexts(["x"], config, fetchImpl)).rejects.toThrow(/500/);
  });

  it("throws when data array length does not match input length", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ data: [{ embedding: [0.1], index: 0 }] }),
    );
    await expect(embedTexts(["a", "b"], config, fetchImpl)).rejects.toThrow(/1 for 2/);
  });

  it("openrouter routes through the same OpenAI-compat path", async () => {
    const orConfig: EmbeddingProviderConfig = {
      provider: "openrouter",
      apiEndpoint: "https://openrouter.ai/api/v1",
      apiKey: "or-key",
      model: "openai/text-embedding-3-large",
    };
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer or-key");
      return jsonResponse({ data: [{ embedding: [0.5], index: 0 }] });
    });
    expect(await embedTexts(["x"], orConfig, fetchImpl)).toEqual([[0.5]]);
  });
});

describe("EmbeddingError", () => {
  it("carries provider and status", () => {
    const err = new EmbeddingError("boom", "ollama", 502);
    expect(err.name).toBe("EmbeddingError");
    expect(err.provider).toBe("ollama");
    expect(err.status).toBe(502);
    expect(err.message).toBe("boom");
  });
});
