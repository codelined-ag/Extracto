import { NextRequest, NextResponse } from "next/server";

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
const OPENAI_MODEL_PATHS = ["v1/models", "models"] as const;
const DEFAULT_MODEL_PATHS = ["api/tags", "v1/models", "models"] as const;

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

function parseProviderHint(rawProvider: string | null): string {
  return rawProvider?.trim().toLowerCase().split(":")[0] ?? "";
}

function getModelPaths(providerHint?: string): readonly string[] {
  if (providerHint === "ollama") {
    return OLLAMA_MODEL_PATHS;
  }

  if (providerHint === "mistral") {
    return OPENAI_MODEL_PATHS;
  }

  return DEFAULT_MODEL_PATHS;
}

export async function GET(request: NextRequest) {
  const settings = await getApiSettings();
  const query = new URL(request.url).searchParams;

  const rawHost = query.get("host")?.trim() || settings.apiEndpoint;
  const providerHint = parseProviderHint(query.get("provider"));
  const apiKey =
    query.get("apiKey")?.trim() || request.headers.get("x-api-key")?.trim() || settings.apiKey;
  let candidateHosts: string[] = [];

  if (!rawHost) {
    return NextResponse.json(
      { error: "Missing host. Configure API endpoint in settings first." },
      { status: 400 }
    );
  }

  try {
    candidateHosts = buildOllamaHostCandidates(rawHost, DISCOVERY_FALLBACK_HOST);
    const effectiveHost = candidateHosts[0] || DISCOVERY_FALLBACK_HOST;
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
        hint: OLLAMA_NETWORK_HINT,
      },
      { status: 502 }
    );
  }
}

async function discoverModels(
  candidateHosts: string[],
  apiKey: string,
  providerHint?: string
): Promise<NormalizedModel[]> {
  const provider = providerHint?.toLowerCase();
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
    const normalizedHost = normalizeHostEndpoint(hostCandidate, DISCOVERY_FALLBACK_HOST);
    if (!normalizedHost) {
      continue;
    }

    const candidateBases = buildEndpointBases(normalizedHost);
    const candidateUrls = Array.from(
      new Set(candidateBases.flatMap((base) => candidates.map((path) => `${base}/${path}`)))
    );

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
        const models = normalizeModelsFromPayload(payload, pathHint);
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

function normalizeModelsFromPayload(payload: unknown, path: string): NormalizedModel[] {
  if (!payload || typeof payload !== "object") return [];

  const entries = payload as {
    models?: unknown[];
    data?: unknown[];
  };

  if (Array.isArray(entries.models)) {
    return entries.models
      .map((model) => parseModelEntry(model, path === "api/tags" ? "ollama" : "openai-compatible"))
      .filter((model): model is NormalizedModel => Boolean(model));
  }

  if (Array.isArray(payload as unknown[]) && path !== "api/tags") {
    return (payload as unknown[])
      .map((model) => parseModelEntry(model, "openai-compatible"))
      .filter((model): model is NormalizedModel => Boolean(model));
  }

  if (Array.isArray(entries.data)) {
    return entries.data
      .map((model) => parseModelEntry(model, "openai-compatible"))
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

  if (!id) {
    return null;
  }

  return {
    id,
    name: id,
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
