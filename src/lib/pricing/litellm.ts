import type { ModelPricing } from "@/lib/pricing/types";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 8000;

interface LiteLLMEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  input_cost_per_image?: number;
  litellm_provider?: string;
  mode?: string;
}

interface LiteLLMRegistry {
  fetchedAt: number;
  byId: Map<string, ModelPricing>;
  byIdLower: Map<string, ModelPricing>;
}

let cache: LiteLLMRegistry | null = null;
let inflight: Promise<LiteLLMRegistry> | null = null;
let lastFailureAt = 0;

function safeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function buildPricing(entry: LiteLLMEntry): ModelPricing {
  return {
    inputCostPerToken: safeNumber(entry.input_cost_per_token),
    outputCostPerToken: safeNumber(entry.output_cost_per_token),
    inputCostPerImage: safeNumber(entry.input_cost_per_image),
    inputCostPerPage: 0,
    flatPerRequest: 0,
    source: "litellm-mirror",
    warnings: [],
  };
}

async function fetchRegistry(): Promise<LiteLLMRegistry> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LITELLM_URL, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`LiteLLM pricing fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as Record<string, LiteLLMEntry>;
    const byId = new Map<string, ModelPricing>();
    const byIdLower = new Map<string, ModelPricing>();
    for (const [id, entry] of Object.entries(body)) {
      if (id && entry && typeof entry === "object") {
        const pricing = buildPricing(entry);
        byId.set(id, pricing);
        byIdLower.set(id.toLowerCase(), pricing);
      }
    }
    return { byId, byIdLower, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

async function getRegistry(): Promise<LiteLLMRegistry> {
  const fresh = cache && Date.now() - cache.fetchedAt < TTL_MS;
  if (fresh && cache) return cache;
  if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
    if (cache) return cache;
    throw new Error("LiteLLM pricing temporarily unavailable (cooldown)");
  }
  if (inflight) return inflight;
  inflight = fetchRegistry()
    .then((reg) => {
      cache = reg;
      return reg;
    })
    .catch((error) => {
      lastFailureAt = Date.now();
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  try {
    return await inflight;
  } catch (error) {
    if (cache) return cache;
    throw error;
  }
}

export async function getLitellmPricing(model: string): Promise<ModelPricing | null> {
  try {
    const reg = await getRegistry();
    return reg.byId.get(model) ?? reg.byIdLower.get(model.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

export function __resetLitellmPricingCacheForTests(): void {
  cache = null;
  inflight = null;
  lastFailureAt = 0;
}
