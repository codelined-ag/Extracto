import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// provider-config.ts reads env vars at import time. Use vi.resetModules() so
// each test gets a fresh evaluation under its env fixture.

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  // Wipe all the env vars provider-config reads so tests start from a known state
  for (const key of [
    "MISTRAL_OCR_API_URL", "MISTRAL_OCR_MODEL", "MISTRAL_MODELS",
    "OPENROUTER_API_URL", "OPENROUTER_REFERER", "OPENROUTER_TITLE",
    "OPENROUTER_MODELS",
    "OPENAI_COMPAT_API_URL", "OPENAI_COMPAT_MODELS",
  ]) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

describe("constant defaults (no env)", () => {
  it("OLLAMA_DEFAULT_HOST is the loopback default", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.OLLAMA_DEFAULT_HOST).toBe("http://127.0.0.1:11434");
  });

  it("OLLAMA_DISCOVERY_PATHS contains both /api/tags and /v1/models", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect([...mod.OLLAMA_DISCOVERY_PATHS]).toEqual(["/api/tags", "/v1/models"]);
  });

  it("DEFAULT_MISTRAL_API_URL falls back to api.mistral.ai/v1/ocr", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_API_URL).toBe("https://api.mistral.ai/v1/ocr");
  });

  it("DEFAULT_MISTRAL_OCR_MODEL defaults to 'mistral-ocr-latest'", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_OCR_MODEL).toBe("mistral-ocr-latest");
  });

  it("DEFAULT_OPENROUTER_API_URL falls back to openrouter.ai/api/v1", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENROUTER_API_URL).toBe("https://openrouter.ai/api/v1");
  });

  it("OPENROUTER_TITLE defaults to 'Extracto'", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.OPENROUTER_TITLE).toBe("Extracto");
  });

  it("OPENROUTER_REFERER defaults to empty string", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.OPENROUTER_REFERER).toBe("");
  });

  it("DEFAULT_OPENAI_COMPAT_API_URL falls back to api.openai.com/v1", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENAI_COMPAT_API_URL).toBe("https://api.openai.com/v1");
  });
});

describe("DEFAULT_MISTRAL_MODELS", () => {
  it("falls back to the built-in list when MISTRAL_MODELS is unset", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_MODELS).toContain("mistral-ocr-latest");
    expect(mod.DEFAULT_MISTRAL_MODELS).toContain("pixtral-12b");
    expect(mod.DEFAULT_MISTRAL_MODELS.length).toBeGreaterThan(0);
  });

  it("uses MISTRAL_MODELS when set (comma-separated)", async () => {
    process.env.MISTRAL_MODELS = "model-a,model-b,model-c";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_MODELS).toEqual(["model-a", "model-b", "model-c"]);
  });

  it("trims whitespace and skips empty entries", async () => {
    process.env.MISTRAL_MODELS = "  model-a , , model-b  ";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_MODELS).toEqual(["model-a", "model-b"]);
  });

  it("deduplicates entries", async () => {
    process.env.MISTRAL_MODELS = "model-a,model-b,model-a";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_MODELS).toEqual(["model-a", "model-b"]);
  });

  it("falls back to defaults when env var is empty string", async () => {
    process.env.MISTRAL_MODELS = "";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_MODELS).toContain("mistral-ocr-latest");
  });
});

describe("DEFAULT_OPENROUTER_FALLBACK_MODELS", () => {
  it("includes well-known models in the default list", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENROUTER_FALLBACK_MODELS).toContain("openai/gpt-4o");
    expect(mod.DEFAULT_OPENROUTER_FALLBACK_MODELS).toContain("anthropic/claude-3.5-sonnet");
  });

  it("uses OPENROUTER_MODELS env var when set", async () => {
    process.env.OPENROUTER_MODELS = "custom/model-1,custom/model-2";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENROUTER_FALLBACK_MODELS).toEqual(["custom/model-1", "custom/model-2"]);
  });
});

describe("DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS", () => {
  it("falls back to a small default list", async () => {
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS).toContain("gpt-4o");
    expect(mod.DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS).toContain("gpt-4o-mini");
  });

  it("uses OPENAI_COMPAT_MODELS env var when set", async () => {
    process.env.OPENAI_COMPAT_MODELS = "llama3.1-70b,mixtral-8x7b";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS).toEqual(["llama3.1-70b", "mixtral-8x7b"]);
  });
});

describe("env var overrides for URLs", () => {
  it("MISTRAL_OCR_API_URL overrides the default", async () => {
    process.env.MISTRAL_OCR_API_URL = "https://custom.mistral.example.com/v1/ocr";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_API_URL).toBe("https://custom.mistral.example.com/v1/ocr");
  });

  it("OPENROUTER_API_URL overrides the default", async () => {
    process.env.OPENROUTER_API_URL = "https://my.openrouter.proxy/api/v1";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENROUTER_API_URL).toBe("https://my.openrouter.proxy/api/v1");
  });

  it("OPENAI_COMPAT_API_URL overrides the default", async () => {
    process.env.OPENAI_COMPAT_API_URL = "http://localhost:8080/v1";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_OPENAI_COMPAT_API_URL).toBe("http://localhost:8080/v1");
  });

  it("MISTRAL_OCR_MODEL overrides the default", async () => {
    process.env.MISTRAL_OCR_MODEL = "custom-ocr-model";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_OCR_MODEL).toBe("custom-ocr-model");
  });

  it("env URLs are trimmed", async () => {
    process.env.MISTRAL_OCR_API_URL = "  https://api.example.com/v1/ocr  ";
    const mod = await import("@/lib/ocr/provider-config");
    expect(mod.DEFAULT_MISTRAL_API_URL).toBe("https://api.example.com/v1/ocr");
  });
});
