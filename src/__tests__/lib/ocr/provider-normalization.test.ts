import { describe, it, expect, vi } from "vitest";

// host-normalization.ts reads /proc/net/route at import time. The functions we
// test here only call normalizeHostEndpoint and isLikelyLocalhostEndpoint, both
// pure string operations.
vi.mock("@/lib/ocr/host-normalization", async () => {
  return {
    normalizeHostEndpoint: (raw: string, fallback: string): string => {
      const trimmed = (raw || "").trim();
      if (!trimmed) return fallback;
      if (/^https?:\/\//i.test(trimmed)) return trimmed;
      return `http://${trimmed}`;
    },
    isLikelyLocalhostEndpoint: (endpoint: string): boolean => {
      return /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(?:\/.*)?$/i.test(endpoint);
    },
  };
});

import {
  normalizeMistralEndpoint,
  normalizeOllamaEndpoint,
  normalizeOpenAICompatEndpoint,
  normalizeOpenRouterEndpoint,
} from "@/lib/ocr/provider-normalization";

const MISTRAL_FALLBACK = "https://api.mistral.ai/v1/ocr";
const OPENROUTER_FALLBACK = "https://openrouter.ai/api/v1";
const OPENAI_FALLBACK = "https://api.openai.com/v1";
const OLLAMA_FALLBACK = "http://127.0.0.1:11434";

describe("normalizeMistralEndpoint", () => {
  it("returns the fallback for empty input", () => {
    expect(normalizeMistralEndpoint("", MISTRAL_FALLBACK)).toBe(MISTRAL_FALLBACK);
  });

  it("appends /v1/ocr to a bare origin", () => {
    expect(normalizeMistralEndpoint("https://api.example.com", MISTRAL_FALLBACK))
      .toBe("https://api.example.com/v1/ocr");
  });

  it("is idempotent for /v1/ocr endpoints", () => {
    expect(normalizeMistralEndpoint("https://api.mistral.ai/v1/ocr", MISTRAL_FALLBACK))
      .toBe("https://api.mistral.ai/v1/ocr");
  });

  it("rewrites /v1/models -> /v1/ocr", () => {
    expect(normalizeMistralEndpoint("https://api.mistral.ai/v1/models", MISTRAL_FALLBACK))
      .toBe("https://api.mistral.ai/v1/ocr");
  });

  it("rewrites /models -> /v1/ocr", () => {
    expect(normalizeMistralEndpoint("https://api.example.com/models", MISTRAL_FALLBACK))
      .toBe("https://api.example.com/v1/ocr");
  });

  it("rewrites /ocr (no /v1) to /v1/ocr", () => {
    expect(normalizeMistralEndpoint("https://api.example.com/ocr", MISTRAL_FALLBACK))
      .toBe("https://api.example.com/v1/ocr");
  });

  it("appends /ocr to a /v1 endpoint", () => {
    expect(normalizeMistralEndpoint("https://api.example.com/v1", MISTRAL_FALLBACK))
      .toBe("https://api.example.com/v1/ocr");
  });

  it("appends /v1/ocr to an arbitrary path", () => {
    expect(normalizeMistralEndpoint("https://api.example.com/custom", MISTRAL_FALLBACK))
      .toBe("https://api.example.com/custom/v1/ocr");
  });

  it("strips search and hash", () => {
    expect(normalizeMistralEndpoint("https://api.mistral.ai/v1/ocr?x=1#frag", MISTRAL_FALLBACK))
      .toBe("https://api.mistral.ai/v1/ocr");
  });

  it("strips trailing slashes from path", () => {
    expect(normalizeMistralEndpoint("https://api.mistral.ai/v1/ocr/", MISTRAL_FALLBACK))
      .toBe("https://api.mistral.ai/v1/ocr");
  });

  it("returns fallback when input is unparseable", () => {
    expect(normalizeMistralEndpoint("not a url", MISTRAL_FALLBACK)).toBe(MISTRAL_FALLBACK);
  });
});

describe("normalizeOpenRouterEndpoint", () => {
  it("returns fallback for empty input", () => {
    expect(normalizeOpenRouterEndpoint("", OPENROUTER_FALLBACK)).toBe(OPENROUTER_FALLBACK);
  });

  it("appends /api/v1 to a bare origin", () => {
    expect(normalizeOpenRouterEndpoint("https://openrouter.ai", OPENROUTER_FALLBACK))
      .toBe("https://openrouter.ai/api/v1");
  });

  it("appends /v1 to a /api endpoint", () => {
    expect(normalizeOpenRouterEndpoint("https://openrouter.ai/api", OPENROUTER_FALLBACK))
      .toBe("https://openrouter.ai/api/v1");
  });

  it("is idempotent for /api/v1 endpoints", () => {
    expect(normalizeOpenRouterEndpoint("https://openrouter.ai/api/v1", OPENROUTER_FALLBACK))
      .toBe("https://openrouter.ai/api/v1");
  });

  it("preserves arbitrary paths", () => {
    expect(normalizeOpenRouterEndpoint("https://proxy.example.com/openrouter", OPENROUTER_FALLBACK))
      .toBe("https://proxy.example.com/openrouter");
  });

  it("strips search and hash", () => {
    expect(normalizeOpenRouterEndpoint("https://openrouter.ai/api/v1?key=abc", OPENROUTER_FALLBACK))
      .toBe("https://openrouter.ai/api/v1");
  });
});

describe("normalizeOpenAICompatEndpoint", () => {
  it("returns fallback for empty input", () => {
    expect(normalizeOpenAICompatEndpoint("", OPENAI_FALLBACK)).toBe(OPENAI_FALLBACK);
  });

  it("preserves user-supplied path verbatim (BYO endpoint)", () => {
    expect(normalizeOpenAICompatEndpoint("https://my-vllm.example.com/openai/v1", OPENAI_FALLBACK))
      .toBe("https://my-vllm.example.com/openai/v1");
  });

  it("strips trailing slash", () => {
    expect(normalizeOpenAICompatEndpoint("https://api.openai.com/v1/", OPENAI_FALLBACK))
      .toBe("https://api.openai.com/v1");
  });

  it("strips search params", () => {
    expect(normalizeOpenAICompatEndpoint("https://api.openai.com/v1?token=secret", OPENAI_FALLBACK))
      .toBe("https://api.openai.com/v1");
  });

  it("does NOT add /v1 to a root URL (BYO design intent)", () => {
    expect(normalizeOpenAICompatEndpoint("https://localhost:8080/", OPENAI_FALLBACK))
      .toBe("https://localhost:8080");
  });
});

describe("normalizeOllamaEndpoint", () => {
  it("returns configuredHost for empty input", () => {
    expect(normalizeOllamaEndpoint("", OLLAMA_FALLBACK, false)).toBe(OLLAMA_FALLBACK);
  });

  it("returns configuredHost for localhost when preserveLocalhost=false", () => {
    expect(normalizeOllamaEndpoint("http://127.0.0.1:11434", OLLAMA_FALLBACK, false))
      .toBe(OLLAMA_FALLBACK);
  });

  it("preserves localhost when preserveLocalhost=true", () => {
    expect(normalizeOllamaEndpoint("http://127.0.0.1:11434", OLLAMA_FALLBACK, true))
      .toBe("http://127.0.0.1:11434");
  });

  it("preserves non-localhost endpoints regardless of flag", () => {
    expect(normalizeOllamaEndpoint("http://ollama.internal:11434", OLLAMA_FALLBACK, false))
      .toBe("http://ollama.internal:11434");
  });

  it("rewrites localhost variants when preserveLocalhost=false", () => {
    expect(normalizeOllamaEndpoint("http://localhost:11434", OLLAMA_FALLBACK, false))
      .toBe(OLLAMA_FALLBACK);
    expect(normalizeOllamaEndpoint("http://0.0.0.0:11434", OLLAMA_FALLBACK, false))
      .toBe(OLLAMA_FALLBACK);
  });
});
