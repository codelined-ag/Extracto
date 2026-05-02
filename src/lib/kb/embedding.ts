// Embedding providers for the KB pipeline.
//
// Each adapter takes a list of strings and returns a list of float vectors,
// in the same order. Implementations call the provider's HTTP API with
// fetch (no SDK), so the only runtime cost is the network round trip.
//
// All providers share the same EmbeddingProviderConfig shape so callers
// can dispatch via embedTexts() without knowing the underlying API.

import type { EmbeddingProviderConfig } from "@/lib/kb/types";

const EMBEDDING_TIMEOUT_MS = 60_000;

export class EmbeddingError extends Error {
  constructor(message: string, public readonly provider: string, public readonly status?: number) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Embed an array of texts via the configured provider. Returns vectors
 * in the same order as the input. Throws EmbeddingError on any failure.
 */
export async function embedTexts(
  texts: string[],
  config: EmbeddingProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  switch (config.provider) {
    case "ollama":
      return embedWithOllama(texts, config, fetchImpl);
    case "openai_compat":
    case "openrouter":
      return embedWithOpenAICompat(texts, config, fetchImpl);
    default: {
      const _exhaustive: never = config.provider;
      throw new EmbeddingError(
        `Unknown embedding provider: ${_exhaustive as string}`,
        _exhaustive as string,
      );
    }
  }
}

/**
 * Ollama exposes /api/embeddings (single prompt at a time) and
 * /api/embed (batch, newer). We use /api/embed when available; fall back
 * to a sequential loop on /api/embeddings for compatibility.
 */
async function embedWithOllama(
  texts: string[],
  config: EmbeddingProviderConfig,
  fetchImpl: typeof fetch,
): Promise<number[][]> {
  const base = config.apiEndpoint.replace(/\/+$/u, "");
  // Try the batch endpoint first.
  const batchUrl = `${base}/api/embed`;
  const batchBody = JSON.stringify({ model: config.model, input: texts });

  const batchResp = await fetchWithTimeout(fetchImpl, batchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: batchBody,
  });

  if (batchResp.ok) {
    const json = (await batchResp.json()) as { embeddings?: number[][] };
    if (Array.isArray(json.embeddings) && json.embeddings.length === texts.length) {
      return json.embeddings;
    }
    throw new EmbeddingError(
      `Ollama /api/embed returned ${json.embeddings?.length ?? 0} vectors for ${texts.length} inputs`,
      "ollama",
    );
  }

  // Fall back to single-prompt /api/embeddings for older Ollama versions.
  const singleUrl = `${base}/api/embeddings`;
  const out: number[][] = [];
  for (const text of texts) {
    const resp = await fetchWithTimeout(fetchImpl, singleUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, prompt: text }),
    });
    if (!resp.ok) {
      throw new EmbeddingError(
        `Ollama /api/embeddings ${resp.status}: ${resp.statusText}`,
        "ollama",
        resp.status,
      );
    }
    const json = (await resp.json()) as { embedding?: number[] };
    if (!Array.isArray(json.embedding)) {
      throw new EmbeddingError(
        `Ollama /api/embeddings returned no 'embedding' field`,
        "ollama",
      );
    }
    out.push(json.embedding);
  }
  return out;
}

/**
 * OpenAI-compatible /v1/embeddings (also used for OpenRouter, vLLM,
 * Together, Fireworks, etc.). Single batch request per call.
 */
async function embedWithOpenAICompat(
  texts: string[],
  config: EmbeddingProviderConfig,
  fetchImpl: typeof fetch,
): Promise<number[][]> {
  const base = config.apiEndpoint.replace(/\/+$/u, "");
  const url = `${base}/embeddings`.replace(/\/+/g, "/").replace(":/", "://");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const resp = await fetchWithTimeout(fetchImpl, url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: config.model, input: texts }),
  });

  if (!resp.ok) {
    let message = `${resp.status} ${resp.statusText}`;
    try {
      const errJson = (await resp.json()) as { error?: { message?: string } };
      if (errJson.error?.message) message = errJson.error.message;
    } catch {
      /* response wasn't JSON */
    }
    throw new EmbeddingError(`OpenAI-compat embeddings: ${message}`, config.provider, resp.status);
  }
  const json = (await resp.json()) as { data?: Array<{ embedding?: number[]; index?: number }> };
  if (!Array.isArray(json.data) || json.data.length !== texts.length) {
    throw new EmbeddingError(
      `OpenAI-compat embeddings returned ${json.data?.length ?? 0} for ${texts.length} inputs`,
      config.provider,
    );
  }
  // OpenAI guarantees response.data is sorted by index, but be defensive.
  const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors: number[][] = [];
  for (const entry of sorted) {
    if (!Array.isArray(entry.embedding)) {
      throw new EmbeddingError(
        `OpenAI-compat embeddings: missing 'embedding' on a data entry`,
        config.provider,
      );
    }
    vectors.push(entry.embedding);
  }
  return vectors;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = EMBEDDING_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
