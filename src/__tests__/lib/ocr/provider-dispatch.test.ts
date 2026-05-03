import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ocr/ollama-dispatch", () => ({
  decorateOllamaErrors: vi.fn((_endpoint: string, fn: () => unknown) => fn()),
  getOllamaCandidatesForOcr: vi.fn((endpoint: string) => [endpoint]),
}));

vi.mock("@/lib/ocr/providers/ollama", () => ({
  runOllamaOcr: vi.fn(),
  runOllamaPostProcessing: vi.fn(),
}));

vi.mock("@/lib/ocr/providers/compat", () => ({
  OPENAI_COMPAT_CONFIG: { id: "openai_compat" },
  OPENROUTER_CONFIG: { id: "openrouter" },
  runCompatOcr: vi.fn(),
  runCompatPostProcessing: vi.fn(),
}));

vi.mock("@/lib/ocr/providers/mistral", () => ({
  runMistralOcr: vi.fn(),
  runMistralPostProcessing: vi.fn(),
}));

import { runOllamaOcr, runOllamaPostProcessing } from "@/lib/ocr/providers/ollama";
import { runCompatOcr, runCompatPostProcessing } from "@/lib/ocr/providers/compat";
import { runMistralOcr, runMistralPostProcessing } from "@/lib/ocr/providers/mistral";
import { runProviderOcr, runProviderPostProcessing } from "@/lib/ocr/provider-dispatch";

const mOllamaOcr = runOllamaOcr as ReturnType<typeof vi.fn>;
const mOllamaPP = runOllamaPostProcessing as ReturnType<typeof vi.fn>;
const mCompatOcr = runCompatOcr as ReturnType<typeof vi.fn>;
const mCompatPP = runCompatPostProcessing as ReturnType<typeof vi.fn>;
const mMistralOcr = runMistralOcr as ReturnType<typeof vi.fn>;
const mMistralPP = runMistralPostProcessing as ReturnType<typeof vi.fn>;

const baseSettings = { provider: "ollama", apiEndpoint: "http://h", apiKey: "" } as const;

beforeEach(() => {
  for (const m of [mOllamaOcr, mOllamaPP, mCompatOcr, mCompatPP, mMistralOcr, mMistralPP]) {
    m.mockReset();
    m.mockResolvedValue({ text: "", structured: { markdown: "" }, metadata: {} });
  }
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_COMPAT_API_KEY;
  delete process.env.MISTRAL_API_KEY;
});
afterEach(() => vi.clearAllMocks());

describe("runProviderOcr", () => {
  it("routes ollama through the underlying runner with resolved candidates", async () => {
    await runProviderOcr("ollama", { ...baseSettings, apiEndpoint: "http://o" }, "model-1", "prompt", "preview");
    expect(mOllamaOcr).toHaveBeenCalledWith(["http://o"], "model-1", "prompt", "preview", undefined);
    expect(mCompatOcr).not.toHaveBeenCalled();
    expect(mMistralOcr).not.toHaveBeenCalled();
  });

  it("routes openrouter through the compat runner with the configured baseUrl + key", async () => {
    await runProviderOcr(
      "openrouter",
      { provider: "openrouter", apiEndpoint: "http://or", apiKey: "user-key" },
      "claude",
      "prompt",
      "preview",
    );
    expect(mCompatOcr).toHaveBeenCalledWith(
      { id: "openrouter" },
      "http://or",
      "claude",
      "user-key",
      "prompt",
      "preview",
      undefined,
    );
  });

  it("falls back to OPENROUTER_API_KEY env var when settings.apiKey is empty", async () => {
    process.env.OPENROUTER_API_KEY = "env-key";
    await runProviderOcr(
      "openrouter",
      { provider: "openrouter", apiEndpoint: "http://or", apiKey: "" },
      "claude",
      "prompt",
      "preview",
    );
    expect(mCompatOcr.mock.calls[0][3]).toBe("env-key");
  });

  it("routes openai_compat through compat runner with OPENAI_COMPAT_API_KEY env fallback", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "env-compat";
    await runProviderOcr(
      "openai_compat",
      { provider: "openai_compat", apiEndpoint: "http://x", apiKey: "" },
      "gpt-4",
      "prompt",
      "preview",
    );
    expect(mCompatOcr).toHaveBeenCalledWith(
      { id: "openai_compat" },
      "http://x",
      "gpt-4",
      "env-compat",
      "prompt",
      "preview",
      undefined,
    );
  });

  it("routes mistral with the per-call key (env fallback honored)", async () => {
    process.env.MISTRAL_API_KEY = "mk";
    await runProviderOcr(
      "mistral",
      { provider: "mistral", apiEndpoint: "http://m", apiKey: "" },
      "mistral-ocr",
      "ignored-prompt",
      "preview",
    );
    expect(mMistralOcr).toHaveBeenCalledWith("http://m", "mistral-ocr", "mk", "preview", undefined);
  });

  it("forwards the AbortSignal end-to-end", async () => {
    const ctrl = new AbortController();
    await runProviderOcr("ollama", baseSettings, "m", "p", "pv", ctrl.signal);
    expect(mOllamaOcr.mock.calls[0][4]).toBe(ctrl.signal);
  });
});

describe("runProviderPostProcessing", () => {
  it("routes ollama post-processing through the underlying runner with resolved candidates", async () => {
    await runProviderPostProcessing(
      "ollama",
      { ...baseSettings, apiEndpoint: "http://o" },
      "model",
      "sys",
      "user",
      "markdown",
    );
    expect(mOllamaPP).toHaveBeenCalledWith(["http://o"], "model", "sys", "user", "markdown", undefined);
  });

  it("routes mistral post-processing with the resolved API key", async () => {
    await runProviderPostProcessing(
      "mistral",
      { provider: "mistral", apiEndpoint: "http://m", apiKey: "k" },
      "mistral-large",
      "sys",
      "user",
      "json",
    );
    expect(mMistralPP).toHaveBeenCalledWith("http://m", "mistral-large", "k", "sys", "user", "json", undefined);
  });

  it("routes openrouter + openai_compat post-processing through the compat runner", async () => {
    await runProviderPostProcessing(
      "openrouter",
      { provider: "openrouter", apiEndpoint: "http://or", apiKey: "k1" },
      "claude",
      "sys",
      "user",
      "markdown",
    );
    expect(mCompatPP.mock.calls[0]).toEqual([
      { id: "openrouter" },
      "http://or",
      "claude",
      "k1",
      "sys",
      "user",
      "markdown",
      undefined,
    ]);

    await runProviderPostProcessing(
      "openai_compat",
      { provider: "openai_compat", apiEndpoint: "http://x", apiKey: "k2" },
      "gpt-4",
      "sys",
      "user",
      "json",
    );
    expect(mCompatPP.mock.calls[1]).toEqual([
      { id: "openai_compat" },
      "http://x",
      "gpt-4",
      "k2",
      "sys",
      "user",
      "json",
      undefined,
    ]);
  });

  it("prefers settings.apiKey over the env fallback when both are set", async () => {
    process.env.MISTRAL_API_KEY = "env-key";
    await runProviderPostProcessing(
      "mistral",
      { provider: "mistral", apiEndpoint: "http://m", apiKey: "explicit" },
      "m",
      "sys",
      "user",
      "markdown",
    );
    expect(mMistralPP.mock.calls[0][2]).toBe("explicit");
  });
});
