import type { ModelPricing } from "@/lib/pricing/types";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 8000;

interface OpenRouterPricing {
  prompt?: string;
  completion?: string;
  image?: string;
  request?: string;
}

interface OpenRouterModel {
  id?: string;
  pricing?: OpenRouterPricing;
}

interface OpenRouterListResponse {
  data?: OpenRouterModel[];
}

interface CachedCatalog {
  byId: Map<string, ModelPricing>;
  fetchedAt: number;
}

let cache: CachedCatalog | null = null;
let inflight: Promise<CachedCatalog> | null = null;
let lastFailureAt = 0;

function parseDecimal(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function buildPricing(model: OpenRouterModel): ModelPricing {
  const p = model.pricing ?? {};
  return {
    inputCostPerToken: parseDecimal(p.prompt),
    outputCostPerToken: parseDecimal(p.completion),
    inputCostPerImage: parseDecimal(p.image),
    inputCostPerPage: 0,
    flatPerRequest: parseDecimal(p.request),
    source: "openrouter-live",
    warnings: [],
  };
}

async function fetchCatalog(): Promise<CachedCatalog> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenRouter pricing fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as OpenRouterListResponse;
    const byId = new Map<string, ModelPricing>();
    for (const model of body.data ?? []) {
      if (typeof model.id === "string" && model.id.length > 0) {
        byId.set(model.id, buildPricing(model));
      }
    }
    return { byId, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

async function getCatalog(): Promise<CachedCatalog> {
  const fresh = cache && Date.now() - cache.fetchedAt < TTL_MS;
  if (fresh && cache) return cache;
  if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
    if (cache) return cache;
    throw new Error("OpenRouter pricing temporarily unavailable (cooldown)");
  }
  if (inflight) return inflight;
  inflight = fetchCatalog()
    .then((catalog) => {
      cache = catalog;
      return catalog;
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

export async function getOpenRouterPricing(model: string): Promise<ModelPricing | null> {
  try {
    const catalog = await getCatalog();
    const hit = catalog.byId.get(model);
    return hit ?? null;
  } catch {
    return null;
  }
}

export function __resetOpenRouterPricingCacheForTests(): void {
  cache = null;
  inflight = null;
  lastFailureAt = 0;
}
