import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCompatEndpoint,
  discoverCompatModels,
  normalizeOpenAICompatApiBase,
  normalizeOpenRouterApiBase,
  OPENAI_COMPAT_CONFIG,
  OPENROUTER_CONFIG,
  runCompatOcr,
  runCompatPostProcessing,
} from "@/lib/ocr/providers/compat";

const PREVIEW =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const realFetch = global.fetch;
let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFetch = vi.fn();
  global.fetch = mockedFetch as unknown as typeof fetch;
  // Reset module-level caches between tests so cache hits in one test don't
  // affect another.
  OPENROUTER_CONFIG.modelCache.clear();
  OPENAI_COMPAT_CONFIG.modelCache.clear();
});
afterEach(() => {
  global.fetch = realFetch;
});

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const errJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("normalizeOpenRouterApiBase", () => {
  it("returns the default URL for empty input", () => {
    expect(normalizeOpenRouterApiBase("")).toBe("https://openrouter.ai/api/v1");
  });

  it("preserves a fully-formed openrouter base", () => {
    expect(normalizeOpenRouterApiBase("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
  });

  it("appends /v1 to a bare /api path", () => {
    expect(normalizeOpenRouterApiBase("https://openrouter.ai/api")).toBe("https://openrouter.ai/api/v1");
  });

  it("strips a trailing /chat/completions the user pasted", () => {
    expect(normalizeOpenRouterApiBase("https://openrouter.ai/api/v1/chat/completions")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("strips a trailing /models the user pasted", () => {
    expect(normalizeOpenRouterApiBase("https://openrouter.ai/api/v1/models")).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("auto-prefixes https:// for schemeless input", () => {
    expect(normalizeOpenRouterApiBase("openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
  });

  it("preserves a custom path verbatim (BYO endpoints can host openrouter at any path)", () => {
    expect(normalizeOpenRouterApiBase("https://my.proxy.com/openrouter")).toBe(
      "https://my.proxy.com/openrouter",
    );
  });
});

describe("normalizeOpenAICompatApiBase", () => {
  it("returns the default URL for empty input", () => {
    expect(normalizeOpenAICompatApiBase("")).toBe("https://api.openai.com/v1");
  });

  it("preserves the user-supplied base path verbatim (BYO-endpoint contract)", () => {
    expect(normalizeOpenAICompatApiBase("https://my.host/llm/api/v1")).toBe("https://my.host/llm/api/v1");
  });

  it("strips a trailing /chat/completions but does NOT auto-add /v1", () => {
    // Compat is BYO; we don't know the operator's base path shape so we don't
    // add /v1 the way OpenRouter does.
    expect(normalizeOpenAICompatApiBase("https://my.host/v1/chat/completions")).toBe("https://my.host/v1");
  });

  it("strips trailing slashes", () => {
    expect(normalizeOpenAICompatApiBase("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1");
  });

  it("auto-prefixes https:// for schemeless input", () => {
    expect(normalizeOpenAICompatApiBase("api.openai.com/v1")).toBe("https://api.openai.com/v1");
  });
});

describe("buildCompatEndpoint", () => {
  it("appends /chat/completions to the normalized base for OpenRouter", () => {
    expect(buildCompatEndpoint(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "/chat/completions")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });

  it("appends /models to the normalized base for OpenAI-compat", () => {
    expect(buildCompatEndpoint(OPENAI_COMPAT_CONFIG, "https://api.openai.com/v1", "/models")).toBe(
      "https://api.openai.com/v1/models",
    );
  });
});

describe("OPENROUTER_CONFIG.buildHeaders", () => {
  it("includes Authorization, Content-Type, X-Title", () => {
    const headers = OPENROUTER_CONFIG.buildHeaders("test-key");
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Title"]).toBeTruthy();
  });
});

describe("OPENAI_COMPAT_CONFIG.buildHeaders", () => {
  it("includes ONLY Authorization + Content-Type — no X-Title or HTTP-Referer (those confuse strict OpenAI servers)", () => {
    const headers = OPENAI_COMPAT_CONFIG.buildHeaders("k");
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Title"]).toBeUndefined();
    expect(headers["HTTP-Referer"]).toBeUndefined();
  });
});

describe("OPENROUTER_CONFIG.buildDiscoveryHeaders", () => {
  it("omits Authorization when no apiKey is given", () => {
    const headers = OPENROUTER_CONFIG.buildDiscoveryHeaders("");
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("application/json");
    expect(headers["X-Title"]).toBeTruthy();
  });

  it("includes Bearer Authorization when apiKey is given", () => {
    expect(OPENROUTER_CONFIG.buildDiscoveryHeaders("k").Authorization).toBe("Bearer k");
  });
});

describe("runCompatOcr — request shape", () => {
  it("sends OpenAI-compatible chat-completions body with image_url part and the right headers (OpenRouter)", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "extracted" } }] }));

    await runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "anthropic/claude", "k", "p", PREVIEW);

    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect((init.headers as Record<string, string>)["X-Title"]).toBeTruthy();
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("anthropic/claude");
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content[0]).toEqual({ type: "text", text: "p" });
    expect(body.messages[0].content[1].type).toBe("image_url");
    expect(body.messages[0].content[1].image_url.url).toBe(PREVIEW);
  });

  it("uses the OPENAI_COMPAT_CONFIG to send vanilla OpenAI body (no X-Title)", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "x" } }] }));
    await runCompatOcr(OPENAI_COMPAT_CONFIG, "https://api.openai.com/v1", "gpt-4o", "k", "p", PREVIEW);
    expect((mockedFetch.mock.calls[0][1].headers as Record<string, string>)["X-Title"]).toBeUndefined();
  });

  it("rejects with ApiRouteError(500) when apiKey is empty", async () => {
    await expect(runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "", "p", PREVIEW))
      .rejects.toMatchObject({ status: 500, message: expect.stringContaining("API key") });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("rejects with ApiRouteError(400) for empty preview", async () => {
    await expect(runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "p", "")).rejects
      .toMatchObject({ status: 400, message: expect.stringContaining("Invalid image data") });
  });
});

describe("runCompatOcr — response parsing", () => {
  it("returns text and parses structured JSON when content is a JSON object", async () => {
    const inner = JSON.stringify({ markdown: "## doc", fields: { total: "42" } });
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: inner } }] }));
    const result = await runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "p", PREVIEW);
    expect(result.text).toBe("## doc");
    expect(result.structured.fields).toEqual({ total: "42" });
    expect(result.metadata.outputFormat).toBe("json");
  });

  it("treats raw markdown content as parseMode='markdown'", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "# raw md" } }] }));
    const result = await runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "p", PREVIEW);
    expect(result.text).toBe("# raw md");
    expect(result.metadata.outputFormat).toBe("markdown");
  });

  it("preserves usage info in metadata", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    );
    const result = await runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "p", PREVIEW);
    expect(result.metadata.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
  });

  it("rejects with the upstream status code on non-OK", async () => {
    mockedFetch.mockResolvedValueOnce(errJson(401, { error: { message: "invalid key" } }));
    await expect(
      runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "p", PREVIEW),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rejects with 502 when no choices array is returned", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({}));
    await expect(
      runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "p", PREVIEW),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("had no text") });
  });

  it("rejects with 502 when choices[0].message.content is empty", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "" } }] }));
    await expect(
      runCompatOcr(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "p", PREVIEW),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("runCompatPostProcessing", () => {
  it("rejects when apiKey is empty", async () => {
    await expect(
      runCompatPostProcessing(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "", "s", "u", "markdown"),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("sends system + user messages and adds response_format json_object when outputFormat='json'", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"a":1}' } }] }));
    await runCompatPostProcessing(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "s", "u", "json");
    const body = JSON.parse(mockedFetch.mock.calls[0][1].body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: "s" });
    expect(body.messages[1]).toEqual({ role: "user", content: "u" });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("does NOT add response_format when outputFormat='markdown'", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "ok" } }] }));
    await runCompatPostProcessing(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "m", "k", "s", "u", "markdown");
    const body = JSON.parse(mockedFetch.mock.calls[0][1].body as string);
    expect(body.response_format).toBeUndefined();
  });

  it("returns endpoint in metadata so the route can attribute usage", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "ok" } }] }));
    const result = await runCompatPostProcessing(
      OPENAI_COMPAT_CONFIG,
      "https://api.openai.com/v1",
      "m",
      "k",
      "s",
      "u",
      "markdown",
    );
    expect(result.metadata.endpoint).toBe("https://api.openai.com/v1/chat/completions");
  });
});

describe("discoverCompatModels", () => {
  it("returns extracted ids from the /models response data array", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ data: [{ id: "model-a" }, { id: "model-b" }] }));
    const models = await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k");
    expect(models).toEqual(["model-a", "model-b"]);
  });

  it("dedupes ids while preserving first-seen order", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] }),
    );
    const models = await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k");
    expect(models).toEqual(["a", "b"]);
  });

  it("returns an empty array when payload.data is missing or non-array", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({}));
    const models = await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k");
    expect(models).toEqual([]);
  });

  it("rejects with the upstream status when /models returns an error", async () => {
    mockedFetch.mockResolvedValueOnce(errJson(401, { error: { message: "no auth" } }));
    await expect(discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("uses cached results on second call (does NOT hit fetch a second time)", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ data: [{ id: "cached-model" }] }));
    await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k");
    const second = await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(["cached-model"]);
  });

  it("scopes the cache by apiKey — different keys do NOT share results", async () => {
    mockedFetch
      .mockResolvedValueOnce(okJson({ data: [{ id: "for-k1" }] }))
      .mockResolvedValueOnce(okJson({ data: [{ id: "for-k2" }] }));
    const a = await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k1");
    const b = await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k2");
    expect(a).toEqual(["for-k1"]);
    expect(b).toEqual(["for-k2"]);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("scopes cache between OpenRouter and OpenAI-compat configs (separate Map instances)", async () => {
    mockedFetch
      .mockResolvedValueOnce(okJson({ data: [{ id: "openrouter-only" }] }))
      .mockResolvedValueOnce(okJson({ data: [{ id: "openai-only" }] }));
    await discoverCompatModels(OPENROUTER_CONFIG, "https://openrouter.ai/api/v1", "k");
    await discoverCompatModels(OPENAI_COMPAT_CONFIG, "https://api.openai.com/v1", "k");
    expect(OPENROUTER_CONFIG.modelCache.size).toBe(1);
    expect(OPENAI_COMPAT_CONFIG.modelCache.size).toBe(1);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});
