import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiProviderSettings, ProviderKind } from "@/lib/api-types";
import {
  OPENAI_COMPAT_CONFIG,
  OPENROUTER_CONFIG,
} from "@/lib/ocr/providers/compat";
import {
  runProviderOcr,
  runProviderPostProcessing,
} from "@/lib/ocr/provider-dispatch";

const PREVIEW =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const realFetch = global.fetch;
let mockedFetch: ReturnType<typeof vi.fn>;

function settingsFor(provider: ProviderKind, endpoint: string, apiKey = "k_test"): ApiProviderSettings {
  return { provider, apiEndpoint: endpoint, apiKey };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mockedFetch = vi.fn();
  global.fetch = mockedFetch as unknown as typeof fetch;
  OPENROUTER_CONFIG.modelCache.clear();
  OPENAI_COMPAT_CONFIG.modelCache.clear();
  for (const k of [
    "OPENAI_COMPAT_ALLOWED_HOSTS",
    "OLLAMA_ALLOWED_HOSTS",
    "MISTRAL_ALLOWED_HOSTS",
    "OPENROUTER_API_KEY",
    "OPENAI_COMPAT_API_KEY",
    "MISTRAL_API_KEY",
  ]) {
    delete process.env[k];
  }
  process.env.OPENAI_COMPAT_ALLOWED_HOSTS = "openai-compat.test";
  process.env.OLLAMA_ALLOWED_HOSTS = "ollama.test";
  process.env.MISTRAL_ALLOWED_HOSTS = "mistral.test";
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("runProviderOcr dispatch (4 providers, contract test)", () => {
  it("openrouter: POSTs OpenAI-compat chat-completions with Bearer auth and image content", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "extracted text from openrouter" } }],
      }),
    );

    const result = await runProviderOcr(
      "openrouter",
      settingsFor("openrouter", "https://openrouter.ai/api/v1", "sk-or-test"),
      "anthropic/claude-3.5-sonnet",
      "OCR this image",
      PREVIEW,
    );

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test");
    expect(headers["X-Title"]).toBeTruthy();
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.model).toBe("anthropic/claude-3.5-sonnet");
    expect(body.messages.at(-1)?.role).toBe("user");
    const content = body.messages.at(-1)?.content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
    expect(content.some((part) => part.type === "image_url" && part.image_url?.url === PREVIEW)).toBe(true);
    expect(content.some((part) => part.type === "text")).toBe(true);
    expect(result.text).toContain("extracted text from openrouter");
  });

  it("openai_compat: POSTs vanilla OpenAI shape (no X-Title header)", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "vllm extracted text" } }],
      }),
    );

    const result = await runProviderOcr(
      "openai_compat",
      settingsFor("openai_compat", "https://openai-compat.test/v1", "sk-test"),
      "Qwen/Qwen2-VL-7B-Instruct",
      "Extract text",
      PREVIEW,
    );

    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openai-compat.test/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["X-Title"]).toBeUndefined();
    expect(headers["HTTP-Referer"]).toBeUndefined();
    expect(result.text).toContain("vllm extracted text");
  });

  it("mistral: POSTs to /ocr with Bearer auth and a document.image_url body", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        pages: [{ index: 0, markdown: "## Page 1\n\nMistral extracted." }],
      }),
    );

    const result = await runProviderOcr(
      "mistral",
      settingsFor("mistral", "https://mistral.test/v1", "key_mistral"),
      "mistral-ocr-latest",
      "ignored prompt for mistral",
      PREVIEW,
    );

    expect(mockedFetch).toHaveBeenCalled();
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/mistral\.test\/v1\/ocr/);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key_mistral");
    const body = JSON.parse(init.body as string) as {
      model: string;
      document: { type: string; image_url: string };
    };
    expect(body.model).toBe("mistral-ocr-latest");
    expect(body.document.type).toBe("image_url");
    expect(body.document.image_url).toBe(PREVIEW);
    expect(result.text).toContain("Mistral extracted");
  });

  it("ollama: POSTs to /api/chat (or /v1/chat/completions) with the ollama message shape", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        message: { role: "assistant", content: "ollama OCR output" },
      }),
    );

    const result = await runProviderOcr(
      "ollama",
      settingsFor("ollama", "http://ollama.test:11434", ""),
      "qwen2.5vl",
      "Read this",
      PREVIEW,
    );

    expect(mockedFetch).toHaveBeenCalled();
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/ollama\.test:11434(\/api\/chat|\/v1\/chat\/completions)/);
    expect(init.method).toBe("POST");
    expect(result.text).toContain("ollama OCR output");
  });

  it("rejects an openai_compat endpoint not in OPENAI_COMPAT_ALLOWED_HOSTS", async () => {
    delete process.env.OPENAI_COMPAT_ALLOWED_HOSTS;
    await expect(
      runProviderOcr(
        "openai_compat",
        settingsFor("openai_compat", "https://not-allowed.test/v1", "sk"),
        "model",
        "prompt",
        PREVIEW,
      ),
    ).rejects.toThrow();
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("runProviderPostProcessing dispatch (4 providers)", () => {
  it("openrouter post-processing hits chat/completions with system + user messages", async () => {
    mockedFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "## Polished\n\nOutput." } }],
      }),
    );

    const result = await runProviderPostProcessing(
      "openrouter",
      settingsFor("openrouter", "https://openrouter.ai/api/v1", "sk-or"),
      "anthropic/claude-3.5-sonnet",
      "You are a helpful editor.",
      "Clean up: hello world.",
      "markdown",
    );

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: Array<{ role: string }> };
    expect(body.messages[0].role).toBe("system");
    expect(body.messages.at(-1)?.role).toBe("user");
    expect(result.text).toContain("Polished");
  });

  it("each provider in PROVIDER_HANDLERS is reachable via runProviderOcr (no missing handler)", async () => {
    const allProviders: ProviderKind[] = ["ollama", "openrouter", "openai_compat", "mistral"];
    for (const provider of allProviders) {
      mockedFetch.mockResolvedValueOnce(
        jsonResponse(
          provider === "mistral"
            ? { pages: [{ markdown: "x" }] }
            : provider === "ollama"
              ? { message: { content: "x" } }
              : { choices: [{ message: { content: "x" } }] },
        ),
      );
      const endpoint =
        provider === "ollama"
          ? "http://ollama.test:11434"
          : provider === "openrouter"
            ? "https://openrouter.ai/api/v1"
            : provider === "openai_compat"
              ? "https://openai-compat.test/v1"
              : "https://mistral.test/v1";
      const out = await runProviderOcr(provider, settingsFor(provider, endpoint, "k"), "m", "p", PREVIEW);
      expect(out.text).toBe("x");
    }
  });
});
