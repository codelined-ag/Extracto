import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRouteError } from "@/lib/api-error";
import {
  runOllamaOcr,
  runOllamaPostProcessing,
  unloadOllamaModel,
  warmupOllamaModel,
} from "@/lib/ocr/providers/ollama";
import { OcrStopRequestedError } from "@/lib/ocr/providers/shared";

// 1×1 transparent PNG
const PREVIEW =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
const PREVIEW_BASE64 = PREVIEW.split(",")[1];

const realFetch = global.fetch;
let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFetch = vi.fn();
  global.fetch = mockedFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

const okJson = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

const errJson = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("runOllamaOcr — request shape", () => {
  it("sends /api/chat first with the Ollama-native body shape (string content + images array)", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({ message: { content: "extracted text" }, done: true, eval_count: 42, total_duration: 1234 }),
    );

    await runOllamaOcr(["http://host:11434"], "llava:7b", "extract text", PREVIEW);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe("http://host:11434/api/chat");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("llava:7b");
    expect(body.stream).toBe(false);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toBe("extract text");
    expect(body.messages[0].images).toEqual([PREVIEW_BASE64]);
  });

  it("falls through to /v1/chat/completions when /api/chat returns non-OK", async () => {
    mockedFetch
      .mockResolvedValueOnce(errJson(404, { error: "no such endpoint" }))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: "from openai shape" } }] }));

    const result = await runOllamaOcr(["http://host:11434"], "llava:7b", "p", PREVIEW);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls[1][0]).toBe("http://host:11434/v1/chat/completions");
    expect(result.text).toBe("from openai shape");
  });

  it("uses OpenAI-style payload (typed-content array) for /v1/chat/completions", async () => {
    mockedFetch
      .mockResolvedValueOnce(errJson(500, { error: "no" }))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: "ok" } }] }));

    await runOllamaOcr(["http://host:11434"], "m", "the prompt", PREVIEW);

    const v1Body = JSON.parse(mockedFetch.mock.calls[1][1].body as string);
    expect(v1Body.temperature).toBe(0);
    expect(v1Body.messages[0].content[0]).toEqual({ type: "text", text: "the prompt" });
    expect(v1Body.messages[0].content[1].type).toBe("image_url");
    expect(v1Body.messages[0].content[1].image_url.url).toBe(PREVIEW);
  });

  it("tries every host × every chat path before giving up", async () => {
    mockedFetch.mockResolvedValue(errJson(500, { error: "down" }));

    await expect(runOllamaOcr(["http://a:11434", "http://b:11434"], "m", "p", PREVIEW)).rejects.toThrow();
    expect(mockedFetch).toHaveBeenCalledTimes(4);
    const urls = mockedFetch.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      "http://a:11434/api/chat",
      "http://a:11434/v1/chat/completions",
      "http://b:11434/api/chat",
      "http://b:11434/v1/chat/completions",
    ]);
  });
});

describe("runOllamaOcr — response parsing", () => {
  it("extracts content from message.content for /api/chat", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ message: { content: "raw markdown body" } }));
    const result = await runOllamaOcr(["http://h:11434"], "m", "p", PREVIEW);
    expect(result.text).toBe("raw markdown body");
  });

  it("preserves done/eval_count/total_duration in metadata", async () => {
    mockedFetch.mockResolvedValueOnce(
      okJson({ message: { content: "hi" }, done: true, eval_count: 99, total_duration: 5_000_000 }),
    );
    const result = await runOllamaOcr(["http://h:11434"], "m", "p", PREVIEW);
    expect(result.metadata.responseDone).toBe(true);
    expect(result.metadata.evalCount).toBe(99);
    expect(result.metadata.totalDurationMs).toBe(5_000_000);
  });

  it("parses structured JSON when the model returns {markdown, fields}", async () => {
    const inner = JSON.stringify({ markdown: "# title", fields: { invoice: "123" } });
    mockedFetch.mockResolvedValueOnce(okJson({ message: { content: inner } }));
    const result = await runOllamaOcr(["http://h:11434"], "m", "p", PREVIEW);
    expect(result.text).toBe("# title");
    expect(result.structured.fields).toEqual({ invoice: "123" });
    expect(result.metadata.outputFormat).toBe("json");
  });

  it("falls back to raw text when content isn't valid JSON", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ message: { content: "## not json, just markdown" } }));
    const result = await runOllamaOcr(["http://h:11434"], "m", "p", PREVIEW);
    expect(result.text).toBe("## not json, just markdown");
    expect(result.metadata.outputFormat).toBe("markdown");
  });

  it("continues to next host when response has empty text", async () => {
    mockedFetch
      .mockResolvedValueOnce(okJson({ message: { content: "" } }))
      .mockResolvedValueOnce(okJson({ message: { content: "" } }))
      .mockResolvedValueOnce(okJson({ message: { content: "actual text" } }));
    const result = await runOllamaOcr(["http://a:11434", "http://b:11434"], "m", "p", PREVIEW);
    expect(result.text).toBe("actual text");
    expect(mockedFetch).toHaveBeenCalledTimes(3);
  });
});

describe("runOllamaOcr — error mapping", () => {
  it("rejects with ApiRouteError(400) for empty preview (parsePreviewImageData returns empty base64)", async () => {
    await expect(runOllamaOcr(["http://h:11434"], "m", "p", "")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("Invalid image data"),
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("aggregates errors from all host attempts in the final ApiRouteError(502) message", async () => {
    mockedFetch
      .mockResolvedValueOnce(errJson(500, { error: "boom 1" }))
      .mockResolvedValueOnce(errJson(503, { error: "boom 2" }));

    await expect(runOllamaOcr(["http://h:11434"], "m", "p", PREVIEW)).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/all hosts/i),
    });
  });

  it("re-throws OcrStopRequestedError without converting to a status code", async () => {
    mockedFetch.mockRejectedValueOnce(new OcrStopRequestedError("user cancelled"));
    await expect(runOllamaOcr(["http://h:11434"], "m", "p", PREVIEW)).rejects.toBeInstanceOf(OcrStopRequestedError);
  });
});

describe("runOllamaOcr — abort signal", () => {
  it("propagates external AbortSignal into fetch as an OcrStopRequestedError", async () => {
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
      runOllamaOcr(["http://h:11434"], "m", "p", PREVIEW, controller.signal),
    ).rejects.toBeInstanceOf(OcrStopRequestedError);
  });
});

describe("runOllamaPostProcessing", () => {
  it("sends system + user messages with stream=false and temperature=0", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ message: { content: "post-processed" } }));

    const result = await runOllamaPostProcessing(["http://h:11434"], "llama3", "sys", "usr");

    expect(result.text).toBe("post-processed");
    const body = JSON.parse(mockedFetch.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0);
  });

  it("returns endpoint in metadata for diagnostics", async () => {
    mockedFetch.mockResolvedValueOnce(okJson({ message: { content: "ok" } }));
    const result = await runOllamaPostProcessing(["http://h:11434"], "m", "s", "u");
    expect(result.metadata.endpoint).toBe("http://h:11434/api/chat");
  });

  it("falls through to /v1/chat/completions when /api/chat fails", async () => {
    mockedFetch
      .mockResolvedValueOnce(errJson(404, { error: "x" }))
      .mockResolvedValueOnce(okJson({ choices: [{ message: { content: "from v1" } }] }));
    const result = await runOllamaPostProcessing(["http://h:11434"], "m", "s", "u");
    expect(result.text).toBe("from v1");
    expect(result.metadata.endpoint).toBe("http://h:11434/v1/chat/completions");
  });

  it("rejects with ApiRouteError(502) when all hosts fail", async () => {
    mockedFetch.mockResolvedValue(errJson(500, { error: "no" }));
    await expect(runOllamaPostProcessing(["http://h:11434"], "m", "s", "u")).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/post-processing failed/i),
    });
  });
});

describe("unloadOllamaModel", () => {
  it("posts to /api/generate with keep_alive=0 to free VRAM", async () => {
    mockedFetch.mockResolvedValueOnce(new Response("", { status: 200 }));

    await unloadOllamaModel(["http://h:11434"], "llama3");

    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe("http://h:11434/api/generate");
    const body = JSON.parse(init.body as string);
    expect(body.keep_alive).toBe(0);
    expect(body.model).toBe("llama3");
    expect(body.prompt).toBe("");
    expect(body.stream).toBe(false);
  });

  it("returns silently after the first successful host (does NOT try remaining hosts)", async () => {
    mockedFetch.mockResolvedValueOnce(new Response("", { status: 200 }));
    await unloadOllamaModel(["http://a:11434", "http://b:11434"], "m");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("tries the next host on failure and never throws (best-effort cleanup)", async () => {
    mockedFetch
      .mockRejectedValueOnce(new TypeError("ECONNREFUSED"))
      .mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(unloadOllamaModel(["http://a:11434", "http://b:11434"], "m")).resolves.toBeUndefined();
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("swallows all errors when every host fails (still returns undefined)", async () => {
    mockedFetch.mockRejectedValue(new TypeError("ECONNREFUSED"));
    await expect(unloadOllamaModel(["http://a:11434", "http://b:11434"], "m")).resolves.toBeUndefined();
  });
});

describe("warmupOllamaModel", () => {
  it("posts to /api/generate with num_predict=1 and keep_alive=10m to pin model in VRAM", async () => {
    mockedFetch.mockResolvedValueOnce(new Response("", { status: 200 }));

    await warmupOllamaModel(["http://h:11434"], "llama3");

    const body = JSON.parse(mockedFetch.mock.calls[0][1].body as string);
    expect(body.options).toEqual({ num_predict: 1 });
    expect(body.keep_alive).toBe("10m");
    expect(body.model).toBe("llama3");
  });

  it("is best-effort: never throws even if every host fails", async () => {
    mockedFetch.mockRejectedValue(new Error("network error"));
    await expect(warmupOllamaModel(["http://a:11434"], "m")).resolves.toBeUndefined();
  });
});
