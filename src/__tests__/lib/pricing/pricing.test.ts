import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeBreakdown,
  DEFAULT_INPUT_TOKENS_PER_PAGE,
  DEFAULT_OUTPUT_TOKENS_PER_PAGE,
  resolveModelPricing,
} from "@/lib/pricing";
import { __resetLitellmPricingCacheForTests } from "@/lib/pricing/litellm";
import { __resetOpenRouterPricingCacheForTests } from "@/lib/pricing/openrouter";
import { getMistralOcrPricing } from "@/lib/pricing/mistral";

describe("getMistralOcrPricing", () => {
  it("returns $0.001/page for mistral-ocr-latest", () => {
    const pricing = getMistralOcrPricing("mistral-ocr-latest");
    expect(pricing).not.toBeNull();
    expect(pricing?.inputCostPerPage).toBe(0.001);
    expect(pricing?.source).toBe("mistral-static");
  });

  it("returns $0.002/page for mistral-ocr-2512", () => {
    const pricing = getMistralOcrPricing("mistral-ocr-2512");
    expect(pricing?.inputCostPerPage).toBe(0.002);
  });

  it("is case-insensitive", () => {
    expect(getMistralOcrPricing("Mistral-OCR-Latest")?.inputCostPerPage).toBe(0.001);
  });

  it("returns null for unknown variants", () => {
    expect(getMistralOcrPricing("mistral-ocr-9999")).toBeNull();
  });
});

describe("computeBreakdown — page-priced (Mistral OCR)", () => {
  it("uses inputCostPerPage and ignores token math when page-priced", () => {
    const breakdown = computeBreakdown(
      {
        provider: "mistral",
        apiEndpoint: "https://api.mistral.ai",
        model: "mistral-ocr-latest",
        pageCount: 100,
        inputTokensPerPage: DEFAULT_INPUT_TOKENS_PER_PAGE,
        outputTokensPerPage: DEFAULT_OUTPUT_TOKENS_PER_PAGE,
      },
      {
        inputCostPerToken: 0,
        outputCostPerToken: 0,
        inputCostPerImage: 0,
        inputCostPerPage: 0.001,
        flatPerRequest: 0,
        source: "mistral-static",
        warnings: [],
      },
    );
    expect(breakdown.totalCost).toBe(0.1);
    expect(breakdown.inputCost).toBe(0);
    expect(breakdown.outputCost).toBe(0);
    expect(breakdown.imageCost).toBe(0);
    expect(breakdown.perPageRate).toBe(0.001);
  });
});

describe("computeBreakdown — token-priced", () => {
  it("multiplies tokens by per-token rates", () => {
    const breakdown = computeBreakdown(
      {
        provider: "openrouter",
        apiEndpoint: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-3.5-sonnet",
        pageCount: 10,
        inputTokensPerPage: 1000,
        outputTokensPerPage: 500,
      },
      {
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
        inputCostPerImage: 0,
        inputCostPerPage: 0,
        flatPerRequest: 0,
        source: "openrouter-live",
        warnings: [],
      },
    );
    expect(breakdown.inputCost).toBe(0.03);
    expect(breakdown.outputCost).toBe(0.075);
    expect(breakdown.totalCost).toBe(0.105);
  });

  it("bills flatPerRequest once per job, not per page", () => {
    const breakdown = computeBreakdown(
      {
        provider: "openrouter",
        apiEndpoint: "https://openrouter.ai/api/v1",
        model: "perplexity/sonar-pro",
        pageCount: 25,
        inputTokensPerPage: 0,
        outputTokensPerPage: 0,
      },
      {
        inputCostPerToken: 0,
        outputCostPerToken: 0,
        inputCostPerImage: 0,
        inputCostPerPage: 0,
        flatPerRequest: 0.005,
        source: "openrouter-live",
        warnings: [],
      },
    );
    expect(breakdown.flatRequestCost).toBe(0.005);
    expect(breakdown.totalCost).toBe(0.005);
  });

  it("uses inputCostPerImage as flat per-page when set, instead of token math", () => {
    const breakdown = computeBreakdown(
      {
        provider: "openrouter",
        apiEndpoint: "https://openrouter.ai/api/v1",
        model: "google/gemini-flash-1.5",
        pageCount: 50,
        inputTokensPerPage: 1000,
        outputTokensPerPage: 500,
      },
      {
        inputCostPerToken: 0.000003,
        outputCostPerToken: 0.000015,
        inputCostPerImage: 0.0001,
        inputCostPerPage: 0,
        flatPerRequest: 0,
        source: "openrouter-live",
        warnings: [],
      },
    );
    expect(breakdown.imageCost).toBe(0.005);
    expect(breakdown.inputCost).toBe(0);
    expect(breakdown.outputCost).toBeCloseTo(0.375, 6);
    expect(breakdown.totalCost).toBeCloseTo(0.38, 6);
  });
});

describe("resolveModelPricing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetLitellmPricingCacheForTests();
    __resetOpenRouterPricingCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ollama-local for ollama provider", async () => {
    const pricing = await resolveModelPricing("ollama", "qwen2.5vl:7b", "http://127.0.0.1:11434");
    expect(pricing.source).toBe("ollama-local");
    expect(pricing.inputCostPerToken).toBe(0);
  });

  it("returns mistral-static for mistral-ocr models", async () => {
    const pricing = await resolveModelPricing("mistral", "mistral-ocr-latest", "https://api.mistral.ai");
    expect(pricing.source).toBe("mistral-static");
    expect(pricing.inputCostPerPage).toBe(0.001);
  });

  it("returns unknown with $0 for an unrecognized mistral OCR id", async () => {
    const pricing = await resolveModelPricing("mistral", "mistral-ocr-9999", "https://api.mistral.ai");
    expect(pricing.source).toBe("unknown");
    expect(pricing.warnings.length).toBeGreaterThan(0);
  });

  it("falls back to LiteLLM for openai_compat targeting api.openai.com when mock returns hit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          "gpt-4o-mini": {
            input_cost_per_token: 0.00000015,
            output_cost_per_token: 0.0000006,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const pricing = await resolveModelPricing(
      "openai_compat",
      "gpt-4o-mini",
      "https://api.openai.com/v1",
    );
    expect(pricing.source).toBe("litellm-mirror");
    expect(pricing.inputCostPerToken).toBe(0.00000015);
  });

  it("flags self-hosted compat with a warning when mirror has the model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          "qwen-vision": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000003 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const pricing = await resolveModelPricing(
      "openai_compat",
      "qwen-vision",
      "https://my-vllm.example.com/v1",
    );
    expect(pricing.source).toBe("litellm-mirror");
    expect(pricing.warnings.some((w) => w.includes("Self-hosted"))).toBe(true);
  });

  it("returns unknown when self-hosted compat model has no mirror entry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const pricing = await resolveModelPricing(
      "openai_compat",
      "private-model",
      "https://internal.example/v1",
    );
    expect(pricing.source).toBe("unknown");
  });

  it("returns openrouter-live pricing when the API responds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "anthropic/claude-3.5-sonnet",
              pricing: { prompt: "0.000003", completion: "0.000015", image: "0.0048", request: "0" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const pricing = await resolveModelPricing(
      "openrouter",
      "anthropic/claude-3.5-sonnet",
      "https://openrouter.ai/api/v1",
    );
    expect(pricing.source).toBe("openrouter-live");
    expect(pricing.inputCostPerToken).toBe(0.000003);
    expect(pricing.outputCostPerToken).toBe(0.000015);
    expect(pricing.inputCostPerImage).toBe(0.0048);
  });

  it("returns unknown when openrouter has no entry for a model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const pricing = await resolveModelPricing(
      "openrouter",
      "ghost/model",
      "https://openrouter.ai/api/v1",
    );
    expect(pricing.source).toBe("unknown");
  });

  it("returns unknown without throwing when openrouter fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const pricing = await resolveModelPricing(
      "openrouter",
      "anthropic/claude-3.5-sonnet",
      "https://openrouter.ai/api/v1",
    );
    expect(pricing.source).toBe("unknown");
  });
});
