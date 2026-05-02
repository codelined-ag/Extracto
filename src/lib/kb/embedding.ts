import type { EmbeddingProviderConfig } from "@/lib/kb/types";

const EMBEDDING_TIMEOUT_MS = 60_000;

export class EmbeddingError extends Error {
  constructor(message: string, public readonly provider: string, public readonly status?: number) {
    super(message);
    this.name = "EmbeddingError";
  }
}

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

interface AttemptResult {
  ok: true;
  vectors: number[][];
}

interface AttemptFailure {
  ok: false;
  status: number | null;
  body: string;
  url: string;
}

async function readBody(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 600);
  } catch {
    return "";
  }
}

export function isModelMissingBody(body: string): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  if (lower.includes("not found") && lower.includes("model")) return true;
  if (lower.includes("file does not exist") || lower.includes("pull it first")) return true;
  return false;
}

function modelMissingHint(body: string, model: string): string | null {
  if (!isModelMissingBody(body)) return null;
  return `MODEL_NOT_PULLED:${model}`;
}

async function embedWithOllama(
  texts: string[],
  config: EmbeddingProviderConfig,
  fetchImpl: typeof fetch,
): Promise<number[][]> {
  const base = config.apiEndpoint.replace(/\/+$/u, "");

  const batchUrl = `${base}/api/embed`;
  const batchAttempt = await tryOllamaEmbed(fetchImpl, batchUrl, texts, config.model);
  if (batchAttempt.ok) return batchAttempt.vectors;

  const v1Url = `${base}/v1/embeddings`;
  const v1Attempt = await tryOpenAICompatBatch(fetchImpl, v1Url, texts, config.model, undefined);
  if (v1Attempt.ok) return v1Attempt.vectors;

  const singleUrl = `${base}/api/embeddings`;
  const singleAttempt = await tryOllamaSingle(fetchImpl, singleUrl, texts, config.model);
  if (singleAttempt.ok) return singleAttempt.vectors;

  const failure = singleAttempt.status != null ? singleAttempt
    : v1Attempt.status != null ? v1Attempt
    : batchAttempt;
  const hint = modelMissingHint(failure.body, config.model);
  const detail = hint
    ?? `Tutti gli endpoint embedding di Ollama hanno fallito (POST ${batchUrl} → ${batchAttempt.status ?? "?"}, POST ${v1Url} → ${v1Attempt.status ?? "?"}, POST ${singleUrl} → ${singleAttempt.status ?? "?"}). Verifica che Ollama sia in esecuzione e che il modello "${config.model}" sia installato (ollama pull ${config.model}).`;
  throw new EmbeddingError(detail, "ollama", failure.status ?? undefined);
}

async function tryOllamaEmbed(
  fetchImpl: typeof fetch,
  url: string,
  texts: string[],
  model: string,
): Promise<AttemptResult | AttemptFailure> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts }),
    });
  } catch (err) {
    return { ok: false, status: null, body: err instanceof Error ? err.message : String(err), url };
  }
  if (!resp.ok) {
    return { ok: false, status: resp.status, body: await readBody(resp), url };
  }
  const json = (await resp.json().catch(() => ({}))) as { embeddings?: number[][] };
  if (Array.isArray(json.embeddings) && json.embeddings.length === texts.length) {
    return { ok: true, vectors: json.embeddings };
  }
  return { ok: false, status: 200, body: `expected ${texts.length} vectors, got ${json.embeddings?.length ?? 0}`, url };
}

async function tryOllamaSingle(
  fetchImpl: typeof fetch,
  url: string,
  texts: string[],
  model: string,
): Promise<AttemptResult | AttemptFailure> {
  const out: number[][] = [];
  for (const text of texts) {
    let resp: Response;
    try {
      resp = await fetchWithTimeout(fetchImpl, url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
      });
    } catch (err) {
      return { ok: false, status: null, body: err instanceof Error ? err.message : String(err), url };
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, body: await readBody(resp), url };
    }
    const json = (await resp.json().catch(() => ({}))) as { embedding?: number[] };
    if (!Array.isArray(json.embedding)) {
      return { ok: false, status: 200, body: "missing 'embedding' field", url };
    }
    out.push(json.embedding);
  }
  return { ok: true, vectors: out };
}

async function tryOpenAICompatBatch(
  fetchImpl: typeof fetch,
  url: string,
  texts: string[],
  model: string,
  apiKey: string | undefined,
): Promise<AttemptResult | AttemptFailure> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input: texts }),
    });
  } catch (err) {
    return { ok: false, status: null, body: err instanceof Error ? err.message : String(err), url };
  }
  if (!resp.ok) {
    return { ok: false, status: resp.status, body: await readBody(resp), url };
  }
  const json = (await resp.json().catch(() => ({}))) as { data?: Array<{ embedding?: number[]; index?: number }> };
  if (!Array.isArray(json.data) || json.data.length !== texts.length) {
    return { ok: false, status: resp.status, body: `expected ${texts.length} vectors, got ${json.data?.length ?? 0}`, url };
  }
  const sorted = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors: number[][] = [];
  for (const entry of sorted) {
    if (!Array.isArray(entry.embedding)) {
      return { ok: false, status: resp.status, body: "missing 'embedding' on a data entry", url };
    }
    vectors.push(entry.embedding);
  }
  return { ok: true, vectors };
}

async function embedWithOpenAICompat(
  texts: string[],
  config: EmbeddingProviderConfig,
  fetchImpl: typeof fetch,
): Promise<number[][]> {
  const base = config.apiEndpoint.replace(/\/+$/u, "");
  const url = `${base}/embeddings`.replace(/\/+/g, "/").replace(":/", "://");
  const attempt = await tryOpenAICompatBatch(fetchImpl, url, texts, config.model, config.apiKey);
  if (attempt.ok) return attempt.vectors;
  const hint = modelMissingHint(attempt.body, config.model);
  const detail = hint
    ?? `OpenAI-compat embeddings failed: ${attempt.status ?? "no response"} ${attempt.body || "(empty body)"}`;
  throw new EmbeddingError(detail, config.provider, attempt.status ?? undefined);
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
