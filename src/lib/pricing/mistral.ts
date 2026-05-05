import type { ModelPricing } from "@/lib/pricing/types";

const LAST_VERIFIED = "2026-05-05";

const PER_PAGE_USD: Record<string, number> = {
  "mistral-ocr-latest": 0.001,
  "mistral-ocr-2506": 0.001,
  "mistral-ocr-2512": 0.002,
};

export function getMistralOcrPricing(model: string): ModelPricing | null {
  const normalized = model.trim().toLowerCase();
  const rate = PER_PAGE_USD[normalized];
  if (rate === undefined) return null;
  return {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    inputCostPerImage: 0,
    inputCostPerPage: rate,
    flatPerRequest: 0,
    source: "mistral-static",
    lastVerified: LAST_VERIFIED,
    warnings: [],
  };
}

export function getMistralChatPricing(model: string): ModelPricing | null {
  const m = model.trim().toLowerCase();
  const table: Record<string, { input: number; output: number }> = {
    "pixtral-12b-2409": { input: 0.00000015, output: 0.00000015 },
    "pixtral-large-latest": { input: 0.000002, output: 0.000006 },
    "pixtral-large-2411": { input: 0.000002, output: 0.000006 },
    "mistral-small-latest": { input: 0.0000002, output: 0.0000006 },
    "mistral-medium-latest": { input: 0.0000004, output: 0.000002 },
    "mistral-large-latest": { input: 0.000002, output: 0.000006 },
  };
  const hit = table[m];
  if (!hit) return null;
  return {
    inputCostPerToken: hit.input,
    outputCostPerToken: hit.output,
    inputCostPerImage: 0,
    inputCostPerPage: 0,
    flatPerRequest: 0,
    source: "mistral-static",
    lastVerified: LAST_VERIFIED,
    warnings: [],
  };
}
