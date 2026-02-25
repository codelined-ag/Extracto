import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/auth/request";
import { enforceProviderEndpointPolicy } from "@/lib/endpoint-policy";
import { getApiSettings } from "@/lib/settings-store";
import {
  buildOllamaHostCandidates,
  normalizeHostEndpoint,
  resolveOllamaHostEndpoint,
} from "@/lib/host-normalization";

interface NormalizedModel {
  id: string;
  name: string;
  provider: string;
}

const MODELS_SOURCE_TIMEOUT_MS = 8000;
const OLLAMA_MODEL_PATHS = ["api/tags", "v1/models"] as const;
const MISTRAL_MODEL_PATHS = ["v1/models"] as const;
const DEFAULT_MODEL_PATHS = ["api/tags", "v1/models"] as const;

const OLLAMA_NETWORK_HINT =
  "If Ollama runs on the host machine, ensure it is not bound only to 127.0.0.1; " +
  "set Ollama on host to listen on 0.0.0.0:11434 and use a host-reachable address in settings " +
  "(for Docker: host.docker.internal:11434).";
const APP_NETWORK_MODE = (process.env.APP_NETWORK_MODE || "bridge")
  .trim()
  .toLowerCase();
const envOllamaHost = resolveOllamaHostEndpoint(
  process.env.OLLAMA_HOST || "",
  "http://127.0.0.1:11434"
);
const FALLBACK_OLLAMA_HOST = resolveOllamaHostEndpoint(
  envOllamaHost,
  "http://127.0.0.1:11434",
);
const DISCOVERY_FALLBACK_HOST =
  APP_NETWORK_MODE === "host" ? "http://127.0.0.1:11434" : FALLBACK_OLLAMA_HOST;
const DEFAULT_MISTRAL_ENDPOINT = normalizeHostEndpoint(
  process.env.MISTRAL_OCR_API_URL || "",
  "https://api.mistral.ai/v1/ocr"
);
const DEFAULT_MISTRAL_MODELS = (() => {
  const configured = (process.env.MISTRAL_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }

  return ["mistral-ocr-latest", "mistral-ocr", "pixtral-12b"];
})();

function parseProviderHint(rawProvider: string | null): "ollama" | "mistral" | "" {
  const normalized = rawProvider?.trim().toLowerCase().split(":")[0] ?? "";
  if (normalized === "mistral") return "mistral";
  if (normalized === "ollama") return "ollama";
  return "";
}

function getModelPaths(providerHint?: "ollama" | "mistral" | ""): readonly string[] {
  if (providerHint === "ollama") {
    return OLLAMA_MODEL_PATHS;
  }

  if (providerHint === "mistral") {
    return MISTRAL_MODEL_PATHS;
  }

  return DEFAULT_MODEL_PATHS;
}

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getApiSettings(userId);
  const query = new URL(request.url).searchParams;

  const providerHint = parseProviderHint(query.get("provider")) || parseProviderHint(settings.provider) || "ollama";
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
}

function buildCandidateHosts(
  rawHost: string,
  providerHint: "ollama" | "mistral" | ""
): string[] {
  if (providerHint === "mistral") {
    return [enforceProviderEndpointPolicy("mistral", rawHost, DEFAULT_MISTRAL_ENDPOINT)];
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
  providerHint?: "ollama" | "mistral" | ""
): Promise<NormalizedModel[]> {
  const provider = providerHint || "";
  const candidates = getModelPaths(provider);

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
      provider === "mistral" ? DEFAULT_MISTRAL_ENDPOINT : DISCOVERY_FALLBACK_HOST
    );
    if (!normalizedHost) {
      continue;
    }

    const candidateBases = provider === "mistral"
      ? buildMistralEndpointBases(normalizedHost)
      : buildEndpointBases(normalizedHost);
    const rawCandidateUrls = Array.from(
      new Set(candidateBases.flatMap((base) => candidates.map((path) => `${base}/${path}`)))
    );
    const candidateUrls = provider === "mistral"
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
        const models = normalizeModelsFromPayload(payload, pathHint, provider);
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
  providerHint: "ollama" | "mistral" | ""
): NormalizedModel[] {
  if (!payload || typeof payload !== "object") return [];

  const entries = payload as {
    models?: unknown[];
    data?: unknown[];
  };
  const fallbackProvider =
    providerHint === "mistral"
      ? "mistral"
      : path === "api/tags"
        ? "ollama"
        : "openai-compatible";

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
