import { ApiRouteError, errorMessage } from "@/lib/api-error";
import { enforceProviderEndpointPolicy } from "@/lib/ocr/endpoint-policy";
import { parseServiceError } from "@/lib/ocr/error-parsing";
import {
  buildOllamaHostCandidates,
  normalizeHostEndpoint,
  resolveOllamaHostEndpoint,
} from "@/lib/ocr/host-normalization";
import {
  OLLAMA_DEFAULT_HOST,
  OLLAMA_DISCOVERY_PATHS,
  OLLAMA_NETWORK_HINT,
} from "@/lib/ocr/provider-config";
import {
  runOllamaOcr,
  runOllamaPostProcessing,
  unloadOllamaModel,
  warmupOllamaModel,
} from "@/lib/ocr/providers/ollama";
import {
  fetchWithTimeout,
  OcrStopRequestedError,
  parseResponseText,
  type OcrRunResult,
  type PostProcessResult,
} from "@/lib/ocr/providers/shared";
import type { PostProcessOutputFormat } from "@/lib/ocr/settings";
import { getFallbackOllamaHost } from "@/lib/ocr/settings-store";

const OLLAMA_MODEL_CACHE_TTL_MS = 60_000;

export function getOllamaDiscoveryFallbackHost(): string {
  return (process.env.APP_NETWORK_MODE || "bridge").trim().toLowerCase() === "host"
    ? OLLAMA_DEFAULT_HOST
    : getFallbackOllamaHost();
}

export interface OllamaModelCatalogResult {
  models: string[];
  host: string;
}

let ollamaModelCache: { values: string[]; expiresAt: number; host: string } = {
  values: [],
  expiresAt: 0,
  host: "",
};

function getOllamaHostCandidates(rawEndpoint: string): string[] {
  const rawCandidates = buildOllamaHostCandidates(rawEndpoint, getOllamaDiscoveryFallbackHost());
  const safeCandidates = rawCandidates
    .map((candidate) => {
      try {
        return enforceProviderEndpointPolicy("ollama", candidate, getOllamaDiscoveryFallbackHost());
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return safeCandidates.length > 0
    ? Array.from(new Set(safeCandidates))
    : [enforceProviderEndpointPolicy("ollama", rawEndpoint, getOllamaDiscoveryFallbackHost())];
}

function normalizeOllamaApiBase(rawEndpoint: string): string {
  return normalizeHostEndpoint(rawEndpoint, getOllamaDiscoveryFallbackHost())
    .replace(/\/api\/?$/i, "")
    .replace(/\/v1\/?$/i, "");
}

function resolveOllamaRuntimeEndpoint(rawEndpoint: string): string {
  const resolvedHost = resolveOllamaHostEndpoint(rawEndpoint, getOllamaDiscoveryFallbackHost());
  return normalizeHostEndpoint(resolvedHost, getOllamaDiscoveryFallbackHost())
    .replace(/\/api\/?$/i, "")
    .replace(/\/v1\/?$/i, "");
}

function getCachedOllamaHost(endpoint: string): string | null {
  const now = Date.now();
  if (!ollamaModelCache.host) return null;
  if (ollamaModelCache.expiresAt <= now || !ollamaModelCache.values.length) return null;
  const candidates = getOllamaHostCandidates(endpoint).map(resolveOllamaRuntimeEndpoint);
  if (candidates.includes(ollamaModelCache.host)) return ollamaModelCache.host;
  return null;
}

function setOllamaModelCache(host: string, values: string[]) {
  ollamaModelCache = {
    values,
    host,
    expiresAt: Date.now() + OLLAMA_MODEL_CACHE_TTL_MS,
  };
}

export function getOllamaCandidatesForOcr(endpoint: string): string[] {
  const candidates = getOllamaHostCandidates(endpoint).map(normalizeOllamaApiBase);
  const normalizedFallback = normalizeOllamaApiBase(getOllamaDiscoveryFallbackHost());
  if (!candidates.includes(normalizedFallback)) {
    candidates.push(normalizedFallback);
  }
  return Array.from(new Set(candidates));
}

export async function getOllamaModels(endpoint: string): Promise<OllamaModelCatalogResult> {
  const cachedHost = getCachedOllamaHost(endpoint);
  if (cachedHost) {
    return { host: cachedHost, models: ollamaModelCache.values };
  }

  const errors: string[] = [];
  const candidates = getOllamaCandidatesForOcr(endpoint);

  for (const host of candidates) {
    for (const path of OLLAMA_DISCOVERY_PATHS) {
      try {
        const response = await fetchWithTimeout(`${host}${path}`, {
          headers: { Accept: "application/json" },
        });
        const payload = await parseResponseText(response);
        if (!response.ok) {
          errors.push(`${host}${path}: ${response.status} ${parseServiceError(response, payload)}`);
          continue;
        }
        if (!payload || typeof payload !== "object") {
          errors.push(`${host}${path}: invalid Ollama model response`);
          continue;
        }
        const candidatePayload = payload as {
          models?: { name?: unknown }[];
          data?: { name?: unknown }[];
        };
        const entries = Array.isArray(candidatePayload.models)
          ? candidatePayload.models
          : Array.isArray(candidatePayload.data)
            ? candidatePayload.data
            : [];
        const values = Array.isArray(entries)
          ? entries
              .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
              .filter((value): value is string => value.length > 0)
          : [];
        if (!values.length) {
          errors.push(`${host}${path}: no models returned`);
          continue;
        }
        const uniqueValues = Array.from(new Set(values));
        setOllamaModelCache(host, uniqueValues);
        return { host, models: uniqueValues };
      } catch (error) {
        errors.push(`${host}${path}: ${errorMessage(error, "Request failed")}`);
      }
    }
  }

  throw new ApiRouteError(`No reachable Ollama host found (${errors.join(" | ")})`, 502);
}

export async function ollamaOcrWithResolvedHost(
  endpoint: string,
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal,
): Promise<OcrRunResult> {
  const hosts = getOllamaCandidatesForOcr(endpoint);
  try {
    return await runOllamaOcr(hosts, model, prompt, preview, signal);
  } catch (error) {
    if (error instanceof OcrStopRequestedError) throw error;
    if (error instanceof ApiRouteError) {
      let resolvedHost: string | null = null;
      try {
        resolvedHost = (await getOllamaModels(endpoint)).host;
      } catch {
        /* keep fallback context */
      }
      const hint = resolvedHost
        ? `Last reachable host was ${resolvedHost}.`
        : "No reachable Ollama endpoint found.";
      throw new ApiRouteError(`${hint} ${error.message}. ${OLLAMA_NETWORK_HINT}`, error.status);
    }
    throw error;
  }
}

/**
 * Shared one-line bridge for the post-processing / unload / warmup
 * helpers. Resolves the Ollama host candidate list once and passes it
 * to the underlying runner — the OCR wrapper above is the odd one
 * because it ALSO decorates errors with an Ollama-network hint.
 *
 * Use the underlying runners directly with a manually-resolved host
 * list when you need the runner without the candidate-list step.
 */
function withResolvedOllamaHosts<T>(
  endpoint: string,
  fn: (hosts: string[]) => Promise<T>,
): Promise<T> {
  return fn(getOllamaCandidatesForOcr(endpoint));
}

export function ollamaPostProcessingWithResolvedHost(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat?: PostProcessOutputFormat,
  signal?: AbortSignal,
): Promise<PostProcessResult> {
  return withResolvedOllamaHosts(endpoint, (hosts) =>
    runOllamaPostProcessing(hosts, model, systemPrompt, userPrompt, outputFormat, signal),
  );
}

export function ollamaUnloadWithResolvedHost(endpoint: string, model: string): Promise<void> {
  return withResolvedOllamaHosts(endpoint, (hosts) => unloadOllamaModel(hosts, model));
}

export function ollamaWarmupWithResolvedHost(endpoint: string, model: string): Promise<void> {
  return withResolvedOllamaHosts(endpoint, (hosts) => warmupOllamaModel(hosts, model));
}
