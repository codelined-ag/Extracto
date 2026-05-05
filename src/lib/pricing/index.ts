import type { ProviderKind } from "@/lib/api-types";
import { getLitellmPricing } from "@/lib/pricing/litellm";
import { getMistralChatPricing, getMistralOcrPricing } from "@/lib/pricing/mistral";
import { getOpenRouterPricing } from "@/lib/pricing/openrouter";
import type {
  ModelPricing,
  OcrCostBreakdown,
  OcrCostInput,
} from "@/lib/pricing/types";

export const DEFAULT_OUTPUT_TOKENS_PER_PAGE = 800;
export const DEFAULT_INPUT_TOKENS_PER_PAGE = 1445;
export const DEFAULT_POST_PROCESSING_OUTPUT_TOKENS_PER_PAGE = 600;

function isMistralOcrModel(model: string): boolean {
  return /^mistral-ocr/i.test(model.trim());
}

function unknownPricing(reason: string): ModelPricing {
  return {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    inputCostPerImage: 0,
    inputCostPerPage: 0,
    flatPerRequest: 0,
    source: "unknown",
    warnings: [reason],
  };
}

function ollamaPricing(): ModelPricing {
  return {
    inputCostPerToken: 0,
    outputCostPerToken: 0,
    inputCostPerImage: 0,
    inputCostPerPage: 0,
    flatPerRequest: 0,
    source: "ollama-local",
    warnings: ["Local Ollama; estimate excludes hardware and electricity cost."],
  };
}

function isOpenAiHost(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return /(^|\.)openai\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export async function resolveModelPricing(
  provider: ProviderKind,
  model: string,
  apiEndpoint: string,
): Promise<ModelPricing> {
  const trimmed = model.trim();
  if (!trimmed) {
    return unknownPricing("Model not specified, returning $0 estimate.");
  }

  if (provider === "ollama") {
    return ollamaPricing();
  }

  if (provider === "mistral") {
    if (isMistralOcrModel(trimmed)) {
      const ocr = getMistralOcrPricing(trimmed);
      if (ocr) return ocr;
      return unknownPricing(`Unknown Mistral OCR variant '${trimmed}', returning $0 estimate.`);
    }
    const chat = getMistralChatPricing(trimmed);
    if (chat) return chat;
    const litellm = await getLitellmPricing(trimmed);
    if (litellm) return litellm;
    return unknownPricing(`No pricing data for Mistral model '${trimmed}'.`);
  }

  if (provider === "openrouter") {
    const live = await getOpenRouterPricing(trimmed);
    if (live) return live;
    return unknownPricing(`No live OpenRouter pricing for '${trimmed}', returning $0 estimate.`);
  }

  if (provider === "openai_compat") {
    if (isOpenAiHost(apiEndpoint)) {
      const litellm = await getLitellmPricing(trimmed);
      if (litellm) return litellm;
      return unknownPricing(`No pricing data for OpenAI model '${trimmed}'.`);
    }
    const litellm = await getLitellmPricing(trimmed);
    if (litellm) {
      return {
        ...litellm,
        warnings: [
          ...litellm.warnings,
          "Self-hosted endpoint; using LiteLLM reference price for this model id, which may not match your provider's actual cost.",
        ],
      };
    }
    return unknownPricing(
      `Self-hosted OpenAI-compatible endpoint and no LiteLLM mirror entry for '${trimmed}'. Estimate excludes provider cost.`,
    );
  }

  return unknownPricing("Unrecognized provider.");
}

export function computeBreakdown(input: OcrCostInput, pricing: ModelPricing): OcrCostBreakdown {
  const pages = Math.max(0, Math.trunc(input.pageCount));
  const inputTokensPerPage = Math.max(0, input.inputTokensPerPage);
  const outputTokensPerPage = Math.max(0, input.outputTokensPerPage);

  const isPagePriced = pricing.inputCostPerPage > 0;
  const usesImageFlat = pricing.inputCostPerImage > 0;

  const inputCost = isPagePriced
    ? 0
    : usesImageFlat
      ? 0
      : round6(pages * inputTokensPerPage * pricing.inputCostPerToken);
  const imageCost = isPagePriced
    ? 0
    : usesImageFlat
      ? round6(pages * pricing.inputCostPerImage)
      : 0;
  const outputCost = isPagePriced
    ? 0
    : round6(pages * outputTokensPerPage * pricing.outputCostPerToken);
  const flatRequestCost = isPagePriced ? 0 : round6(pricing.flatPerRequest);
  const pagePriced = round6(pages * pricing.inputCostPerPage);

  const totalCost = round6(inputCost + imageCost + outputCost + flatRequestCost + pagePriced);
  const perPageRate = pages > 0 ? round6(totalCost / pages) : 0;

  return {
    inputCost,
    imageCost,
    outputCost,
    flatRequestCost,
    perPageRate,
    totalCost,
    pricing,
    pageCount: pages,
    inputTokensPerPage,
    outputTokensPerPage,
  };
}

function round6(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export type { ModelPricing, OcrCostBreakdown, OcrCostInput } from "@/lib/pricing/types";
