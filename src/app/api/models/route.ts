import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-error";
import { authenticateRequest, requireScope } from "@/lib/auth/request";
import { enforceProviderEndpointPolicy, normalizeProvider, ProviderKind } from "@/lib/endpoint-policy";
import { FALLBACK_OLLAMA_HOST, getApiSettings } from "@/lib/settings-store";
import {
  buildOllamaHostCandidates,
  normalizeHostEndpoint,
} from "@/lib/host-normalization";
import {
  DEFAULT_MISTRAL_API_URL,
  DEFAULT_MISTRAL_MODELS,
  OLLAMA_DEFAULT_HOST,
  OLLAMA_NETWORK_HINT,
} from "@/lib/ocr/provider-config";

interface NormalizedModel {
  id: string;
  name: string;
  provider: string;
}

const MODELS_SOURCE_TIMEOUT_MS = 8000;
const OLLAMA_MODEL_PATHS = ["api/tags", "v1/models"] as const;
const MISTRAL_MODEL_PATHS = ["v1/models"] as const;

const APP_NETWORK_MODE = (process.env.APP_NETWORK_MODE || "bridge")
  .trim()
  .toLowerCase();
const DISCOVERY_FALLBACK_HOST =
  APP_NETWORK_MODE === "host" ? OLLAMA_DEFAULT_HOST : FALLBACK_OLLAMA_HOST;
const DEFAULT_MISTRAL_ENDPOINT = normalizeHostEndpoint(
  process.env.MISTRAL_OCR_API_URL || "",
  DEFAULT_MISTRAL_API_URL
);

function getModelPaths(providerHint: ProviderKind): readonly string[] {
  if (providerHint === "ollama") return OLLAMA_MODEL_PATHS;
  return MISTRAL_MODEL_PATHS;
}

export async function GET(request: NextRequest) {
  try {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scopeError = requireScope(auth, "ocr:read");
  if (scopeError) return scopeError;
  const userId = auth.userId;

  const settings = await getApiSettings(userId);
  const query = new URL(request.url).searchParams;

  const providerHint: ProviderKind = normalizeProvider(query.get("provider") || settings.provider);
  const defaultHost = providerHint === "mistral" ? DEFAULT_MISTRAL_ENDPOINT : DISCOVERY_FALLBACK_HOST;
  const rawHost = settings.apiEndpoint || defaultHost;
  const apiKey = settings.apiKey || process.env.MISTRAL_API_KEY || "";
  let candidateHosts: string[] = [];

  if (!rawHost) {
    return NextResponse.json(
      { error: "Missing host. Configure API endpoint in settings first." },
      { status: 400 }
    );
  }
  if (providerHint === "mistral" && !apiKey) {
    const fallbackModels: NormalizedModel[] = DEFAULT_MISTRAL_MODELS.map((id) => ({
      id,
      name: id,
      provider: "mistral",
    }));
    return NextResponse.json({
      provider: "mistral",
      endpoint: enforceProviderEndpointPolicy("mistral", rawHost, DEFAULT_MISTRAL_ENDPOINT),
      attemptedHosts: [],
      models: fallbackModels,
      warning:
        "MISTRAL_API_KEY is not configured. Returning configured fallback models only.",
    });
  }

  try {
    candidateHosts = buildCandidateHosts(rawHost, providerHint);
    const effectiveHost = candidateHosts[0] || defaultHost;
    const models = await discoverModels(candidateHosts, apiKey, providerHint);

    return NextResponse.json({
      provider: providerHint || settings.provider,
      endpoint: effectiveHost,
      attemptedHosts: candidateHosts,
      models,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to fetch models",
        attemptedHosts: candidateHosts,
        hint: providerHint === "ollama" ? OLLAMA_NETWORK_HINT : undefined,
      },
      { status: 502 }
    );
  }
  } catch (error) {
    return handleApiError(error);
  }
}

function buildCandidateHosts(rawHost: string, providerHint: ProviderKind): string[] {
  if (providerHint === "mistral") {
    return [enforceProviderEndpointPolicy("mistral", rawHost, DEFAULT_MISTRAL_ENDPOINT)];
  }

  if (providerHint === "openrouter" || providerHint === "openai_compat") {
    return [enforceProviderEndpointPolicy(providerHint, rawHost, rawHost)];
  }

  const safeOllamaHost = enforceProviderEndpointPolicy("ollama", rawHost, DISCOVERY_FALLBACK_HOST);
  const rawCandidates = buildOllamaHostCandidates(safeOllamaHost, DISCOVERY_FALLBACK_HOST);
  const safeCandidates = rawCandidates
    .map((candidate) => {
      try {
        return enforceProviderEndpointPolicy("ollama", candidate, DISCOVERY_FALLBACK_HOST);
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return safeCandidates.length > 0 ? Array.from(new Set(safeCandidates)) : [safeOllamaHost];
}

async function discoverModels(
  candidateHosts: string[],
  apiKey: string,
  providerHint: ProviderKind
): Promise<NormalizedModel[]> {
  const candidates = getModelPaths(providerHint);

  const errors: string[] = [];

  const headers: HeadersInit = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  for (const hostCandidate of candidateHosts) {
    const normalizedHost = normalizeHostEndpoint(
      hostCandidate,
      providerHint === "mistral" ? DEFAULT_MISTRAL_ENDPOINT : DISCOVERY_FALLBACK_HOST
    );
    if (!normalizedHost) {
      continue;
    }

    const isMistralLike = providerHint === "mistral" || providerHint === "openrouter" || providerHint === "openai_compat";
    const candidateBases = isMistralLike
      ? buildMistralEndpointBases(normalizedHost)
      : buildEndpointBases(normalizedHost);
    const rawCandidateUrls = Array.from(
      new Set(candidateBases.flatMap((base) => candidates.map((path) => `${base}/${path}`)))
    );
    const candidateUrls = isMistralLike
      ? Array.from(
          new Set(
            rawCandidateUrls.flatMap((url) => [url, `${url}?object=list`])
          )
        )
      : rawCandidateUrls;

    for (const url of candidateUrls) {
      try {
        const response = await fetchWithTimeout(url, { headers });
        if (!response.ok) {
          errors.push(`${url}: ${response.status}`);
          continue;
        }

        const payload = await response.json();
        const pathHint = url.endsWith("/api/tags")
          ? "api/tags"
          : url.endsWith("/models")
            ? "models"
            : "v1/models";
        const models = normalizeModelsFromPayload(payload, pathHint, providerHint);
        if (models.length > 0) {
          return dedupeModels(models);
        }

        errors.push(`${url}: empty response payload`);
      } catch (error) {
        errors.push(
          `${url}: ${error instanceof Error ? error.message : "Request failed"}`
        );
      }
    }
  }

  const hasConnectionIssue = errors.some((entry) =>
    /Unable to connect|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|Name or service not known/i.test(entry)
  );

  if (hasConnectionIssue) {
    throw new Error(`No models found. ${errors.join(" | ")} ${OLLAMA_NETWORK_HINT}`);
  }

  throw new Error(`No models found. ${errors.join(" | ")}`);
}

function buildMistralEndpointBases(rawEndpoint: string): string[] {
  const normalized = normalizeHostEndpoint(rawEndpoint, DEFAULT_MISTRAL_ENDPOINT).replace(/\/+$/u, "");

  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/u, "");

    const trimmedBasePath = pathname
      .replace(/\/v1\/ocr$/iu, "")
      .replace(/\/ocr$/iu, "")
      .replace(/\/v1\/models$/iu, "")
      .replace(/\/models$/iu, "")
      .replace(/\/v1$/iu, "");

    const basePath = trimmedBasePath === "/" ? "" : trimmedBasePath;
    const candidateSet = new Set<string>();
    const addCandidate = (nextPath: string) => {
      const candidate = new URL(url.toString());
      candidate.search = "";
      candidate.hash = "";
      candidate.pathname = nextPath || "/";
      candidateSet.add(candidate.toString().replace(/\/+$/u, ""));
    };

    addCandidate(basePath || "/");
    addCandidate(`${basePath}/v1`);

    return Array.from(candidateSet);
  } catch {
    return [normalized];
  }
}

function buildEndpointBases(rawEndpoint: string): string[] {
  const trimmed = rawEndpoint.trim().replace(/\/+$/, "");
  const candidateSet = new Set([trimmed]);

  const withoutV1 = trimmed.replace(/\/v1\/?$/, "");
  if (withoutV1) {
    candidateSet.add(withoutV1);
  }

  const withoutApi = trimmed.replace(/\/api\/?$/, "");
  if (withoutApi) {
    candidateSet.add(withoutApi);
  }

  return Array.from(candidateSet);
}

function normalizeModelsFromPayload(
  payload: unknown,
  path: string,
  providerHint: ProviderKind
): NormalizedModel[] {
  if (!payload || typeof payload !== "object") return [];

  const entries = payload as {
    models?: unknown[];
    data?: unknown[];
  };
  const fallbackProvider =
    providerHint === "ollama"
      ? path === "api/tags" ? "ollama" : "openai-compatible"
      : providerHint;

  if (Array.isArray(entries.models)) {
    return entries.models
      .map((model) => parseModelEntry(model, fallbackProvider))
      .filter((model): model is NormalizedModel => Boolean(model));
  }

  if (Array.isArray(payload as unknown[]) && path !== "api/tags") {
    return (payload as unknown[])
      .map((model) => parseModelEntry(model, fallbackProvider))
      .filter((model): model is NormalizedModel => Boolean(model));
  }

  if (Array.isArray(entries.data)) {
    return entries.data
      .map((model) => parseModelEntry(model, fallbackProvider))
      .filter((model): model is NormalizedModel => Boolean(model));
  }

  return [];
}

function parseModelEntry(model: unknown, fallbackProvider: string): NormalizedModel | null {
  if (!model || typeof model !== "object") {
    return null;
  }

  const typed = model as { id?: unknown; name?: unknown };
  const id = typeof typed.id === "string" ? typed.id : typeof typed.name === "string" ? typed.name : "";
  const name = typeof typed.name === "string" ? typed.name : id;

  if (!id) {
    return null;
  }

  return {
    id,
    name,
    provider: fallbackProvider,
  };
}

function dedupeModels(models: NormalizedModel[]): NormalizedModel[] {
  const byId = new Map<string, NormalizedModel>();

  for (const model of models) {
    if (model.id && !byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }

  return Array.from(byId.values());
}

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODELS_SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: "no-store",
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
