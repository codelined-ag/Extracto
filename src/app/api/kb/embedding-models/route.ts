import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { getKbDefaults } from "@/lib/kb/defaults-store";
import { enforceProviderEndpointPolicy } from "@/lib/ocr/endpoint-policy";
import {
  getDefaultOpenAICompatApiUrl,
  getDefaultOpenRouterApiUrl,
  OLLAMA_DEFAULT_HOST,
} from "@/lib/ocr/provider-config";

interface DiscoverRequest extends Record<string, unknown> {
  provider?: unknown;
  apiEndpoint?: unknown;
  apiKey?: unknown;
}

function getProviderFallbackEndpoint(provider: "ollama" | "openrouter" | "openai_compat"): string {
  if (provider === "openrouter") return getDefaultOpenRouterApiUrl();
  if (provider === "openai_compat") return getDefaultOpenAICompatApiUrl();
  return OLLAMA_DEFAULT_HOST;
}

const FETCH_TIMEOUT_MS = 8_000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function trimSlashes(s: string): string {
  return s.replace(/\/+$/u, "");
}

function isEmbeddingId(id: string): boolean {
  const s = id.toLowerCase();
  return /(embed|bge|nomic|minilm|gte|e5|mxbai|jina|snowflake-arctic-embed|all-minilm)/.test(s);
}

async function listOllamaModels(endpoint: string): Promise<string[]> {
  const url = `${trimSlashes(endpoint)}/api/tags`;
  const resp = await timedFetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!resp.ok) throw new ApiRouteError(`Ollama ${resp.status}: ${resp.statusText}`, 502);
  const json = (await resp.json()) as { models?: Array<{ name?: string }> };
  return (json.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === "string");
}

async function listOpenAICompatModels(endpoint: string, apiKey: string | undefined): Promise<string[]> {
  const url = `${trimSlashes(endpoint)}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const resp = await timedFetch(url, { method: "GET", headers });
  if (!resp.ok) throw new ApiRouteError(`Provider ${resp.status}: ${resp.statusText}`, 502);
  const json = (await resp.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string }> };
  const list = json.data ?? json.models ?? [];
  return list.map((m) => m.id).filter((id): id is string => typeof id === "string");
}

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<DiscoverRequest>(request);
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (provider !== "ollama" && provider !== "openrouter" && provider !== "openai_compat") {
    throw new ApiRouteError("provider must be one of: ollama, openrouter, openai_compat", 400);
  }
  const defaults = await getKbDefaults(auth.userId);
  const rawEndpoint = (typeof body.apiEndpoint === "string" && body.apiEndpoint.trim())
    ? body.apiEndpoint.trim()
    : defaults.embedding.apiEndpoint;
  const apiEndpoint = enforceProviderEndpointPolicy(
    provider,
    rawEndpoint,
    getProviderFallbackEndpoint(provider),
  );
  const apiKey = typeof body.apiKey === "string" && body.apiKey
    ? body.apiKey
    : defaults.embedding.apiKey || undefined;

  let raw: string[] = [];
  try {
    if (provider === "ollama") {
      raw = await listOllamaModels(apiEndpoint);
    } else {
      raw = await listOpenAICompatModels(apiEndpoint, apiKey);
    }
  } catch (err) {
    if (err instanceof ApiRouteError) throw err;
    const message = err instanceof Error ? err.message : "Discovery failed";
    throw new ApiRouteError(message, 502);
  }

  const dedup = Array.from(new Set(raw));
  const embeddings = dedup.filter(isEmbeddingId).sort();
  const others = dedup.filter((id) => !isEmbeddingId(id)).sort();

  return NextResponse.json({
    provider,
    endpoint: apiEndpoint,
    embeddings,
    others,
  });
});
