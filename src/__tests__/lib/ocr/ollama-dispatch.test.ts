import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ocr/host-normalization", () => ({
  buildOllamaHostCandidates: vi.fn((endpoint: string) => [endpoint, "http://fallback:11434"]),
  getFallbackOllamaHost: vi.fn(() => "http://fallback:11434"),
  normalizeHostEndpoint: (e: string) => e.replace(/\/+$/u, ""),
  resolveOllamaHostEndpoint: (e: string) => e,
}));

vi.mock("@/lib/ocr/endpoint-policy", () => ({
  enforceProviderEndpointPolicy: vi.fn((_p: unknown, host: string) => host),
}));

vi.mock("@/lib/ocr/providers/shared", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ocr/providers/shared")>(
    "@/lib/ocr/providers/shared",
  );
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
    parseResponseText: vi.fn(),
  };
});

import { ApiRouteError } from "@/lib/api-error";
import { fetchWithTimeout, parseResponseText, OcrStopRequestedError } from "@/lib/ocr/providers/shared";
import {
  decorateOllamaErrors,
  getOllamaCandidatesForOcr,
  getOllamaModels,
} from "@/lib/ocr/ollama-dispatch";

const mockedFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;
const mockedParse = parseResponseText as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFetch.mockReset();
  mockedParse.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("getOllamaCandidatesForOcr", () => {
  it("strips /api and /v1 trailing segments and dedupes", () => {
    const candidates = getOllamaCandidatesForOcr("http://o:11434/api");
    expect(candidates).toEqual(expect.arrayContaining(["http://o:11434"]));
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("appends the discovery fallback when not already present", () => {
    const candidates = getOllamaCandidatesForOcr("http://other:11434");
    expect(candidates).toContain("http://fallback:11434");
  });
});

describe("getOllamaModels", () => {
  it("returns models from the first reachable host with a non-empty model list", async () => {
    mockedFetch.mockResolvedValueOnce({ ok: true } as Response);
    mockedParse.mockResolvedValueOnce({ models: [{ name: "llama3" }, { name: "qwen" }] });
    const result = await getOllamaModels("http://test-a:11434");
    expect(result.models).toEqual(["llama3", "qwen"]);
    expect(result.host).toBeTruthy();
  });

  it("falls back to the next host on first-host failure", async () => {
    mockedFetch
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Bad" } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    mockedParse
      .mockResolvedValueOnce({ message: "down" })
      .mockResolvedValueOnce({ data: [{ name: "qwen" }] });
    const result = await getOllamaModels("http://test-b:11434");
    expect(result.models).toEqual(["qwen"]);
  });

  it("throws ApiRouteError(502) when no host returns models", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 503, statusText: "Bad" } as Response);
    mockedParse.mockResolvedValue({ message: "down" });
    await expect(getOllamaModels("http://test-c:11434")).rejects.toBeInstanceOf(ApiRouteError);
  });

  it("caches a successful host for subsequent calls on same endpoint", async () => {
    mockedFetch.mockResolvedValue({ ok: true } as Response);
    mockedParse.mockResolvedValue({ models: [{ name: "llama3" }] });
    const first = await getOllamaModels("http://test-d:11434");
    mockedFetch.mockClear();
    const second = await getOllamaModels("http://test-d:11434");
    expect(second.host).toBe(first.host);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("decorateOllamaErrors", () => {
  it("re-throws OcrStopRequestedError unchanged", async () => {
    await expect(
      decorateOllamaErrors("http://o", async () => {
        throw new OcrStopRequestedError();
      }),
    ).rejects.toBeInstanceOf(OcrStopRequestedError);
  });

  it("re-throws non-ApiRouteError unchanged", async () => {
    await expect(
      decorateOllamaErrors("http://o", async () => {
        throw new TypeError("oops");
      }),
    ).rejects.toThrow("oops");
  });

  it("decorates ApiRouteError with the network hint", async () => {
    mockedFetch.mockResolvedValue({ ok: false, status: 503, statusText: "Bad" } as Response);
    mockedParse.mockResolvedValue({ message: "down" });
    await expect(
      decorateOllamaErrors("http://o", async () => {
        throw new ApiRouteError("upstream failed", 502);
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("upstream failed"),
      status: 502,
    });
  });
});
