// OpenAI-compatible provider runner — used for both OpenRouter and the
// generic OpenAI-compatible chat-completions endpoint. The only differences
// between the two are the request headers (OpenRouter wants X-Title +
// HTTP-Referer), the base URL shape, and the model-discovery cache scope.
// Both differences are isolated in CompatProviderConfig so the runner itself
// stays single-implementation.

import { createHash } from "node:crypto";

import { ApiRouteError } from "@/lib/api-error";
import {
  enforceProviderEndpointPolicy,
  type ProviderKind,
} from "@/lib/ocr/endpoint-policy";
import { parseServiceError, parsePreviewImageData } from "@/lib/ocr/error-parsing";
import { parseJsonCandidate } from "@/lib/ocr/markdown-routing";
import {
  DEFAULT_OPENAI_COMPAT_API_URL,
  DEFAULT_OPENROUTER_API_URL,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
} from "@/lib/ocr/provider-config";
import {
  extractChatContentText,
  fetchWithTimeout,
  normalizeStructuredMarkdownPayload,
  parseResponseText,
  REQUEST_TIMEOUT_MS,
  type OcrRunResult,
  type PostProcessResult,
} from "@/lib/ocr/providers/shared";
import type { PostProcessOutputFormat } from "@/lib/ocr/settings";

const OPENROUTER_MODEL_CACHE_TTL_MS = 5 * 60_000;
const OPENAI_COMPAT_MODEL_CACHE_TTL_MS = 5 * 60_000;
const OPENROUTER_MODEL_CACHE_MAX_ENTRIES = 256;
const OPENAI_COMPAT_MODEL_CACHE_MAX_ENTRIES = 256;

export interface CompatProviderConfig {
  provider: Extract<ProviderKind, "openrouter" | "openai_compat">;
  label: string;
  defaultUrl: string;
  normalizeBase: (raw: string) => string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildDiscoveryHeaders: (apiKey: string) => Record<string, string>;
  modelCache: Map<string, { values: string[]; expiresAt: number }>;
  cacheTtlMs: number;
  cacheMaxEntries: number;
}

export function normalizeOpenRouterApiBase(rawEndpoint: string): string {
  const trimmed = rawEndpoint.trim();
  if (!trimmed) {
    return DEFAULT_OPENROUTER_API_URL;
  }

  try {
    const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.search = "";
    url.hash = "";
    let pathname = url.pathname.replace(/\/+$/u, "");
    if (!pathname || pathname === "/") {
      pathname = "/api/v1";
    } else if (pathname.endsWith("/api")) {
      pathname = `${pathname}/v1`;
    }
    pathname = pathname.replace(/\/(chat\/completions|models)$/u, "");
    url.pathname = pathname;
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return DEFAULT_OPENROUTER_API_URL;
  }
}

export function normalizeOpenAICompatApiBase(rawEndpoint: string): string {
  const trimmed = rawEndpoint.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_COMPAT_API_URL;
  }
  try {
    const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.search = "";
    url.hash = "";
    const pathname = url.pathname
      .replace(/\/+$/u, "")
      .replace(/\/(chat\/completions|models)$/u, "");
    url.pathname = pathname;
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return DEFAULT_OPENAI_COMPAT_API_URL;
  }
}

const openRouterModelCache = new Map<string, { values: string[]; expiresAt: number }>();
const openAICompatModelCache = new Map<string, { values: string[]; expiresAt: number }>();

export const OPENROUTER_CONFIG: CompatProviderConfig = {
  provider: "openrouter",
  label: "OpenRouter",
  defaultUrl: DEFAULT_OPENROUTER_API_URL,
  normalizeBase: normalizeOpenRouterApiBase,
  buildHeaders: (apiKey) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Title": OPENROUTER_TITLE,
    };
    if (OPENROUTER_REFERER) headers["HTTP-Referer"] = OPENROUTER_REFERER;
    return headers;
  },
  buildDiscoveryHeaders: (apiKey) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Title": OPENROUTER_TITLE,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (OPENROUTER_REFERER) headers["HTTP-Referer"] = OPENROUTER_REFERER;
    return headers;
  },
  modelCache: openRouterModelCache,
  cacheTtlMs: OPENROUTER_MODEL_CACHE_TTL_MS,
  cacheMaxEntries: OPENROUTER_MODEL_CACHE_MAX_ENTRIES,
};

export const OPENAI_COMPAT_CONFIG: CompatProviderConfig = {
  provider: "openai_compat",
  label: "OpenAI-compatible",
  defaultUrl: DEFAULT_OPENAI_COMPAT_API_URL,
  normalizeBase: normalizeOpenAICompatApiBase,
  // Vanilla OpenAI shape: just Bearer auth + JSON. No X-Title, no HTTP-Referer
  // (those are OpenRouter-specific and confuse strict OpenAI servers).
  buildHeaders: (apiKey) => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  }),
  buildDiscoveryHeaders: (apiKey) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  },
  modelCache: openAICompatModelCache,
  cacheTtlMs: OPENAI_COMPAT_MODEL_CACHE_TTL_MS,
  cacheMaxEntries: OPENAI_COMPAT_MODEL_CACHE_MAX_ENTRIES,
};

export function buildCompatEndpoint(
  cfg: CompatProviderConfig,
  rawEndpoint: string,
  suffix: "/chat/completions" | "/models",
): string {
  const base = cfg.normalizeBase(rawEndpoint || cfg.defaultUrl);
  return enforceProviderEndpointPolicy(cfg.provider, `${base}${suffix}`, `${cfg.defaultUrl}${suffix}`);
}

function buildCompatCacheKey(endpoint: string, apiKey: string): string {
  if (!apiKey) return `${endpoint}|anonymous`;
  // Hash the key so cache keys never log or leak it.
  const digest = createHash("sha256")
    .update(endpoint, "utf8")
    .update("|", "utf8")
    .update(apiKey, "utf8")
    .digest("hex");
  return `${endpoint}|${digest}`;
}

function pruneCompatModelCache(cfg: CompatProviderConfig): void {
  const now = Date.now();
  for (const [key, entry] of cfg.modelCache) {
    if (entry.expiresAt <= now) cfg.modelCache.delete(key);
  }
  while (cfg.modelCache.size > cfg.cacheMaxEntries) {
    const oldestKey = cfg.modelCache.keys().next().value;
    if (oldestKey === undefined) break;
    cfg.modelCache.delete(oldestKey);
  }
}

function getCachedCompatModels(
  cfg: CompatProviderConfig,
  endpoint: string,
  apiKey: string,
): string[] | null {
  const key = buildCompatCacheKey(endpoint, apiKey);
  const entry = cfg.modelCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cfg.modelCache.delete(key);
    return null;
  }
  // Re-insert to mark as recently used so prune evicts genuinely cold entries.
  cfg.modelCache.delete(key);
  cfg.modelCache.set(key, entry);
  return entry.values.length > 0 ? entry.values : null;
}

function setCompatModelCache(
  cfg: CompatProviderConfig,
  endpoint: string,
  apiKey: string,
  values: string[],
): void {
  cfg.modelCache.set(buildCompatCacheKey(endpoint, apiKey), {
    values,
    expiresAt: Date.now() + cfg.cacheTtlMs,
  });
  pruneCompatModelCache(cfg);
}

export async function discoverCompatModels(
  cfg: CompatProviderConfig,
  apiEndpoint: string,
  apiKey: string,
): Promise<string[]> {
  const endpoint = buildCompatEndpoint(cfg, apiEndpoint, "/models");
  const cached = getCachedCompatModels(cfg, endpoint, apiKey);
  if (cached) return cached;

  const response = await fetchWithTimeout(endpoint, { headers: cfg.buildDiscoveryHeaders(apiKey) });
  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `${cfg.label} model discovery failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status,
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError(`Invalid ${cfg.label} model response`, 502);
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const models = data
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" ? id.trim() : "";
    })
    .filter(Boolean);

  const unique = Array.from(new Set(models));
  setCompatModelCache(cfg, endpoint, apiKey, unique);
  return unique;
}

export async function runCompatOcr(
  cfg: CompatProviderConfig,
  apiEndpoint: string,
  model: string,
  apiKey: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal,
): Promise<OcrRunResult> {
  if (!apiKey) {
    throw new ApiRouteError(`${cfg.label} API key is not configured`, 500);
  }

  const imageData = parsePreviewImageData(preview);
  if (!imageData.dataUrl) {
    throw new ApiRouteError(`Invalid image data for ${cfg.label} OCR`, 400);
  }

  const endpoint = buildCompatEndpoint(cfg, apiEndpoint, "/chat/completions");
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: cfg.buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData.dataUrl } },
            ],
          },
        ],
        temperature: 0,
        stream: false,
      }),
    },
    REQUEST_TIMEOUT_MS,
    signal,
  );

  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `${cfg.label} OCR failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status,
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError(`Invalid OCR response from ${cfg.label}`, 502);
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const message = Array.isArray(choices) ? choices[0]?.message : undefined;
  const text = extractChatContentText(message?.content);
  if (!text) {
    throw new ApiRouteError(`${cfg.label} OCR response had no text`, 502);
  }

  const parsed = parseJsonCandidate(text);
  const normalized = normalizeStructuredMarkdownPayload(parsed, text);
  if (!normalized.markdown) {
    throw new ApiRouteError(`${cfg.label} OCR response markdown was empty`, 502);
  }

  const usage = (payload as { usage?: Record<string, unknown> }).usage;
  return {
    text: normalized.markdown,
    structured: normalized.structured,
    metadata: { endpoint, outputFormat: normalized.parseMode, usage },
  };
}

export async function runCompatPostProcessing(
  cfg: CompatProviderConfig,
  apiEndpoint: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat,
): Promise<PostProcessResult> {
  if (!apiKey) {
    throw new ApiRouteError(`${cfg.label} API key is not configured`, 500);
  }

  const endpoint = buildCompatEndpoint(cfg, apiEndpoint, "/chat/completions");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: cfg.buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(outputFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      temperature: 0,
      stream: false,
    }),
  });

  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `${cfg.label} post-processing failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status,
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError(`Invalid post-processing response from ${cfg.label}`, 502);
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const message = Array.isArray(choices) ? choices[0]?.message : undefined;
  const text = extractChatContentText(message?.content);
  if (!text) {
    throw new ApiRouteError(`${cfg.label} post-processing returned empty output`, 502);
  }

  return { text, metadata: { endpoint } };
}
