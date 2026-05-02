import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRouteError } from "@/lib/api-error";
import {
  extractChatContentText,
  fetchWithTimeout,
  normalizeStructuredMarkdownPayload,
  OcrStopRequestedError,
  parseResponseText,
  REQUEST_TIMEOUT_MS,
} from "@/lib/ocr/providers/shared";

// fetchWithTimeout has three failure modes that callers depend on:
//   1) ok response → returned verbatim
//   2) external AbortSignal fires → OcrStopRequestedError (NOT a 504)
//   3) internal timeout fires → ApiRouteError(504)
// The distinction matters because user-cancellation must not surface as a
// gateway-timeout response to clients.

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  vi.useRealTimers();
});

describe("REQUEST_TIMEOUT_MS", () => {
  it("is a sane non-zero value (60s) so production calls don't hang forever", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(60_000);
  });
});

describe("OcrStopRequestedError", () => {
  it("is an Error subclass with the right name", () => {
    const e = new OcrStopRequestedError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("OcrStopRequestedError");
  });

  it("uses default message when none provided", () => {
    expect(new OcrStopRequestedError().message).toBe("OCR stop requested");
  });

  it("respects custom message", () => {
    expect(new OcrStopRequestedError("user cancelled").message).toBe("user cancelled");
  });
});

describe("fetchWithTimeout — happy path", () => {
  it("forwards method, headers, body to fetch and returns the Response", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const response = await fetchWithTimeout("https://example.com/x", {
      method: "POST",
      headers: { "X-Test": "1" },
      body: '{"a":1}',
    });

    expect(response).toBe(mockResponse);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://example.com/x");
    expect(call[1].method).toBe("POST");
    expect((call[1].headers as Record<string, string>)["X-Test"]).toBe("1");
    expect(call[1].body).toBe('{"a":1}');
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });

  it("supplies an AbortSignal even when no external one is given", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("ok"));
    await fetchWithTimeout("https://example.com/x");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("fetchWithTimeout — internal timeout", () => {
  it("throws ApiRouteError(504) when the timeout fires before fetch resolves", async () => {
    global.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    await expect(fetchWithTimeout("https://example.com/x", {}, 5)).rejects.toMatchObject({
      status: 504,
      message: expect.stringMatching(/timeout/i),
    });
  });

  it("includes the configured timeout in the error message", async () => {
    global.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    await expect(fetchWithTimeout("https://example.com/x", {}, 7)).rejects.toMatchObject({
      message: expect.stringContaining("7ms"),
    });
  });
});

describe("fetchWithTimeout — external abort signal", () => {
  it("throws OcrStopRequestedError when an external signal aborts mid-flight", async () => {
    const controller = new AbortController();
    global.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    const promise = fetchWithTimeout("https://example.com/x", {}, 60_000, controller.signal);
    queueMicrotask(() => controller.abort());
    await expect(promise).rejects.toBeInstanceOf(OcrStopRequestedError);
  });

  it("throws OcrStopRequestedError synchronously when external signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    // The internal AbortController is .abort()ed during setup, so when the
    // mock checks signal.aborted at the top of fetch, it should reject
    // synchronously. The implementation matches real fetch behavior here.
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      }
      return new Promise<Response>(() => {});
    });

    await expect(
      fetchWithTimeout("https://example.com/x", {}, 60_000, controller.signal),
    ).rejects.toBeInstanceOf(OcrStopRequestedError);
  });
});

describe("fetchWithTimeout — non-abort errors are passed through", () => {
  it("re-throws network errors verbatim (so providers can build their own error messages)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED"));
    await expect(fetchWithTimeout("https://example.com/x")).rejects.toMatchObject({
      message: "ECONNREFUSED",
    });
  });

  it("does not translate non-AbortError errors into ApiRouteError", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("DNS failed"));
    await expect(fetchWithTimeout("https://example.com/x")).rejects.not.toBeInstanceOf(ApiRouteError);
  });
});

describe("parseResponseText", () => {
  const mkJsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("returns parsed JSON for valid JSON bodies", async () => {
    const result = await parseResponseText(mkJsonResponse(200, { a: 1, b: "x" }));
    expect(result).toEqual({ a: 1, b: "x" });
  });

  it("returns {} for empty bodies (so callers can iterate without null-guards)", async () => {
    expect(await parseResponseText(new Response(""))).toEqual({});
  });

  it("returns {} for whitespace-only bodies", async () => {
    expect(await parseResponseText(new Response("   \n\t  "))).toEqual({});
  });

  it("returns { message: <raw> } for non-JSON text bodies (e.g. nginx HTML error pages)", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    expect(await parseResponseText(new Response(html))).toEqual({ message: html });
  });

  it("preserves array bodies", async () => {
    expect(await parseResponseText(mkJsonResponse(200, [1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

describe("extractChatContentText", () => {
  it("returns string content trimmed", () => {
    expect(extractChatContentText("  hello  ")).toBe("hello");
  });

  it("joins typed text parts in order with newlines", () => {
    const content = [
      { type: "text", text: "first line" },
      { type: "image_url", image_url: { url: "data:image/png;base64,…" } },
      { type: "text", text: "second line" },
    ];
    expect(extractChatContentText(content)).toBe("first line\nsecond line");
  });

  it("trims each text fragment", () => {
    const content = [
      { type: "text", text: "  spaced  " },
      { type: "text", text: "\nnewlined\n" },
    ];
    expect(extractChatContentText(content)).toBe("spaced\nnewlined");
  });

  it("ignores non-string non-typed entries", () => {
    expect(extractChatContentText([null, undefined, { type: "text", text: "kept" }, 42])).toBe("kept");
  });

  it("returns empty string for null / undefined / object content", () => {
    expect(extractChatContentText(null)).toBe("");
    expect(extractChatContentText(undefined)).toBe("");
    expect(extractChatContentText({})).toBe("");
  });

  it("treats raw string array entries as text", () => {
    expect(extractChatContentText(["alpha", "beta"])).toBe("alpha\nbeta");
  });
});

describe("normalizeStructuredMarkdownPayload", () => {
  it("uses the markdown field from a JSON object payload", () => {
    const result = normalizeStructuredMarkdownPayload({ markdown: "# hello" }, "fallback");
    expect(result.markdown).toBe("# hello");
    expect(result.parseMode).toBe("json");
    expect(result.structured.markdown).toBe("# hello");
  });

  it("falls back to text/content when markdown is missing", () => {
    const result = normalizeStructuredMarkdownPayload({ text: "raw text" }, "ignored fallback");
    expect(result.markdown).toBe("raw text");
    expect(result.parseMode).toBe("json");
  });

  it("preserves additional structured fields", () => {
    const result = normalizeStructuredMarkdownPayload(
      { markdown: "# hello", fields: { invoice: "123" } },
      "fb",
    );
    expect(result.structured.fields).toEqual({ invoice: "123" });
  });

  it("returns parseMode='markdown' when input is not an object — uses fallbackMarkdown, NOT the raw value", () => {
    // The function only consults `raw` when it's a plain object. When the
    // model returns a non-JSON string the caller is expected to have already
    // captured it in fallbackMarkdown; the raw string itself is ignored here.
    const result = normalizeStructuredMarkdownPayload("plain markdown", "fb");
    expect(result.markdown).toBe("fb");
    expect(result.parseMode).toBe("markdown");
  });

  it("returns parseMode='markdown' for arrays (treated as not-an-object)", () => {
    const result = normalizeStructuredMarkdownPayload([1, 2, 3], "fb fallback");
    expect(result.parseMode).toBe("markdown");
    expect(result.markdown).toBe("fb fallback");
  });

  it("treats null as not-an-object and uses fallback markdown", () => {
    const result = normalizeStructuredMarkdownPayload(null, "fallback md");
    expect(result.markdown).toBe("fallback md");
    expect(result.parseMode).toBe("markdown");
  });

  it("uses fallback markdown when JSON object has no markdown/text/content", () => {
    const result = normalizeStructuredMarkdownPayload({ unrelated: true }, "fallback x");
    expect(result.markdown).toBe("fallback x");
    expect(result.parseMode).toBe("json");
  });
});
