import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMistralChatEndpoint,
  buildMistralOcrEndpointCandidates,
  isLikelyMistralOcrModel,
  listMistralModels,
  resolveMistralOcrModel,
  runMistralOcr,
  runMistralPostProcessing,
} from "@/lib/ocr/providers/mistral";
import { OcrStopRequestedError } from "@/lib/ocr/providers/shared";

const PREVIEW =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const realFetch = global.fetch;
let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFetch = vi.fn();
  global.fetch = mockedFetch as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = realFetch;
});

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const errJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("isLikelyMistralOcrModel", () => {
  it("returns true for any model name containing 'ocr' (case-insensitive)", () => {
    expect(isLikelyMistralOcrModel("mistral-ocr-latest")).toBe(true);
    expect(isLikelyMistralOcrModel("Mistral-OCR-2024-09")).toBe(true);
  });

  it("returns false for non-ocr models like mistral-large-latest", () => {
    expect(isLikelyMistralOcrModel("mistral-large-latest")).toBe(false);
    expect(isLikelyMistralOcrModel("pixtral-12b")).toBe(false);
  });

  it("trims whitespace before checking", () => {
    expect(isLikelyMistralOcrModel("  mistral-ocr-latest  ")).toBe(true);
  });
});

describe("resolveMistralOcrModel", () => {
  it("returns the input model when it looks like an OCR model", () => {
    expect(resolveMistralOcrModel("mistral-ocr-latest")).toBe("mistral-ocr-latest");
  });

  it("falls back to getDefaultMistralOcrModel() when the input isn't an OCR model", () => {
    // Empty string and non-ocr model names both route to the default OCR model;
    // route.ts uses this so a user picking a chat-only model still gets OCR results.
    expect(resolveMistralOcrModel("mistral-large-latest")).toBe("mistral-ocr-latest");
    expect(resolveMistralOcrModel("")).toBe("mistral-ocr-latest");
  });
});

describe("listMistralModels", () => {
  it("returns at least the default OCR model and de-duplicates", () => {
    const models = listMistralModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("mistral-ocr-latest");
    expect(new Set(models).size).toBe(models.length);
  });
});

describe("buildMistralOcrEndpointCandidates", () => {
  it("returns two candidates: base + base/process so 404 fallback works", () => {
    const candidates = buildMistralOcrEndpointCandidates("https://api.mistral.ai/v1/ocr");
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.some((c) => c.endsWith("/v1/ocr/process"))).toBe(true);
  });

  it("strips a trailing /process if the user already pasted it", () => {
    const candidates = buildMistralOcrEndpointCandidates("https://api.mistral.ai/v1/ocr/process");
    expect(candidates.some((c) => c.endsWith("/v1/ocr"))).toBe(true);
    expect(candidates.some((c) => c.endsWith("/v1/ocr/process"))).toBe(true);
  });

  it("uses default URL when input is empty", () => {
    const candidates = buildMistralOcrEndpointCandidates("");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => /^https:\/\/api\.mistral\.ai\//.test(c))).toBe(true);
  });
});

describe("buildMistralChatEndpoint", () => {
  it("returns the default chat endpoint when input is empty", () => {
    expect(buildMistralChatEndpoint("")).toBe("https://api.mistral.ai/v1/chat/completions");
  });

  it("returns the default chat endpoint when input has no scheme", () => {
    expect(buildMistralChatEndpoint("api.mistral.ai")).toBe("https://api.mistral.ai/v1/chat/completions");
  });

  it("preserves an already-correct chat endpoint", () => {
    expect(buildMistralChatEndpoint("https://api.mistral.ai/v1/chat/completions")).toBe(
      "https://api.mistral.ai/v1/chat/completions",
    );
  });

  it("converts a /v1/ocr endpoint to /v1/chat/completions", () => {
    expect(buildMistralChatEndpoint("https://api.mistral.ai/v1/ocr")).toBe(
      "https://api.mistral.ai/v1/chat/completions",
    );
  });

  it("converts a bare /ocr endpoint to /v1/chat/completions", () => {
    expect(buildMistralChatEndpoint("https://api.mistral.ai/ocr")).toBe(
      "https://api.mistral.ai/v1/chat/completions",
    );
  });

  it("appends /chat/completions to a bare /v1 endpoint", () => {
    expect(buildMistralChatEndpoint("https://api.mistral.ai/v1")).toBe(
      "https://api.mistral.ai/v1/chat/completions",
    );
  });

  it("appends /v1/chat/completions when path is empty", () => {
    expect(buildMistralChatEndpoint("https://api.mistral.ai")).toBe(
      "https://api.mistral.ai/v1/chat/completions",
    );
  });
});

describe("runMistralOcr — request shape", () => {
  it("sends Bearer auth, model, document.image_url=preview, and table_format=markdown", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ pages: [{ markdown: "page1" }] }));

    await runMistralOcr("https://api.mistral.ai/v1/ocr", "mistral-ocr-latest", "secret-key", PREVIEW);

    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toMatch(/api\.mistral\.ai\/v1\/ocr/);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("mistral-ocr-latest");
    expect(body.document.type).toBe("image_url");
    expect(body.document.image_url).toBe(PREVIEW);
    expect(body.table_format).toBe("markdown");
  });

  it("rejects with ApiRouteError(500) when apiKey is empty", async () => {
    await expect(runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "", PREVIEW)).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("MISTRAL_API_KEY"),
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("runMistralOcr — endpoint candidate fallback", () => {
  it("retries on the /process variant when the first candidate returns 404", async () => {
    // Two candidates produced from a /v1/ocr base: /v1/ocr and /v1/ocr/process.
    // First attempt → 404, second → success.
    mockedFetch
      .mockResolvedValueOnce(errJson(404, { error: "not found" }))
      .mockResolvedValueOnce(okJson({ pages: [{ markdown: "page text" }] }));

    const result = await runMistralOcr(
      "https://api.mistral.ai/v1/ocr",
      "mistral-ocr-latest",
      "key",
      PREVIEW,
    );

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("page text");
    expect(result.metadata.endpoint).toMatch(/process$/);
  });

  it("does NOT retry on non-404 errors (those surface immediately)", async () => {
    mockedFetch.mockResolvedValueOnce(errJson(500, { error: "server boom" }));

    await expect(
      runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW),
    ).rejects.toMatchObject({ status: 500 });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces the last 404 if every candidate returns 404", async () => {
    mockedFetch
      .mockResolvedValueOnce(errJson(404, { error: "no" }))
      .mockResolvedValueOnce(errJson(404, { error: "still no" }));

    await expect(
      runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("runMistralOcr — response parsing", () => {
  it("joins per-page markdown fields with double newlines", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({
        pages: [
          { index: 1, markdown: "page one" },
          { index: 2, markdown: "page two" },
        ],
      }),
    );
    const result = await runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW);
    expect(result.text).toBe("page one\n\npage two");
    expect(result.metadata.responsePages).toBe(2);
    expect(result.metadata.pages).toEqual([1, 2]);
  });

  it("falls back to per-page text when markdown is missing", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({ pages: [{ markdown: "", text: "raw text" }] }),
    );
    const result = await runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW);
    expect(result.text).toBe("raw text");
  });

  it("falls back to per-page html when markdown and text are both empty", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ pages: [{ markdown: "", text: "", html: "<p>html</p>" }] }));
    const result = await runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW);
    expect(result.text).toBe("<p>html</p>");
  });

  it("falls back to top-level text when no pages array is present", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ text: "top-level text" }));
    const result = await runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW);
    expect(result.text).toBe("top-level text");
  });

  it("preserves usage_info and document_annotation in metadata", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({
        pages: [{ markdown: "p" }],
        usage_info: { tokens: 100 },
        document_annotation: "summary text",
      }),
    );
    const result = await runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW);
    expect(result.metadata.usageInfo).toEqual({ tokens: 100 });
    expect(result.metadata.documentAnnotation).toBe("summary text");
  });

  it("stringifies object document_annotation in metadata", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({ pages: [{ markdown: "p" }], document_annotation: { kind: "invoice" } }),
    );
    const result = await runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW);
    expect(result.metadata.documentAnnotation).toBe('{"kind":"invoice"}');
  });

  it("rejects with 502 when response has no extractable text", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ pages: [] }));
    await expect(runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("no OCR text"),
    });
  });
});

describe("runMistralOcr — abort signal", () => {
  it("propagates external AbortSignal as OcrStopRequestedError", async () => {
    const controller = new AbortController();
    mockedFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      }
      return new Promise(() => {});
    });
    controller.abort();

    await expect(
      runMistralOcr("https://api.mistral.ai/v1/ocr", "m", "k", PREVIEW, controller.signal),
    ).rejects.toBeInstanceOf(OcrStopRequestedError);
  });
});

describe("runMistralPostProcessing", () => {
  it("rejects when apiKey is empty", async () => {
    await expect(runMistralPostProcessing("https://api.mistral.ai/v1/chat/completions", "m", "", "s", "u", "markdown"))
      .rejects.toMatchObject({ status: 500 });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("sends system + user messages with stream=false and temperature=0", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "polished" } }] }));
    const result = await runMistralPostProcessing(
      "https://api.mistral.ai",
      "mistral-large-latest",
      "key",
      "you are precise",
      "clean this up",
      "markdown",
    );
    expect(result.text).toBe("polished");
    const body = JSON.parse(mockedFetch.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "you are precise" },
      { role: "user", content: "clean this up" },
    ]);
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(false);
  });

  it("adds response_format json_object when outputFormat is 'json'", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: '{"a":1}' } }] }));
    await runMistralPostProcessing("https://api.mistral.ai", "m", "k", "s", "u", "json");
    const body = JSON.parse(mockedFetch.mock.calls[0][1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("does NOT add response_format when outputFormat is 'markdown'", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "ok" } }] }));
    await runMistralPostProcessing("https://api.mistral.ai", "m", "k", "s", "u", "markdown");
    const body = JSON.parse(mockedFetch.mock.calls[0][1].body as string);
    expect(body.response_format).toBeUndefined();
  });

  it("rejects with the upstream status code on non-OK response", async () => {
    mockedFetch.mockResolvedValueOnce(errJson(429, { error: { message: "rate limited" } }));
    await expect(
      runMistralPostProcessing("https://api.mistral.ai", "m", "k", "s", "u", "markdown"),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("rejects with 502 when response shape is missing choices", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({}));
    await expect(
      runMistralPostProcessing("https://api.mistral.ai", "m", "k", "s", "u", "markdown"),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining("empty output") });
  });

  it("includes endpoint in metadata", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ choices: [{ message: { content: "ok" } }] }));
    const result = await runMistralPostProcessing("https://api.mistral.ai", "m", "k", "s", "u", "markdown");
    expect(result.metadata.endpoint).toMatch(/chat\/completions$/);
  });
});
