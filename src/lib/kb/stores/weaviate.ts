import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";
import { VectorStoreError } from "@/lib/kb/stores/error";
import { fetchWithTimeout } from "@/lib/kb/stores/fetch-with-timeout";

export interface WeaviateAdapterConfig {
  baseUrl: string;
  apiKey?: string;
  dimensions?: number;
}

function classNameFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "_");
  const head = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  if (!head || /^[^a-zA-Z]/.test(head)) return `Doc_${head || "default"}`;
  return head;
}

export class WeaviateAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: WeaviateAdapterConfig, fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
    this.base = config.baseUrl.replace(/\/+$/u, "");
  }

  async collectionExists(name: string): Promise<boolean> {
    const className = classNameFor(name);
    const resp = await this.req(`/v1/schema/${encodeURIComponent(className)}`, "GET");
    return resp.ok;
  }

  async upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void> {
    if (chunks.length === 0) return;
    const className = classNameFor(collectionName);
    await this.ensureClass(className);
    const objects = chunks.map((chunk) => {
      const properties: Record<string, unknown> = { text: chunk.text };
      for (const [k, v] of Object.entries(chunk.metadata)) {
        if (v === undefined) continue;
        properties[k] = v;
      }
      return { class: className, properties, vector: chunk.embedding };
    });
    const resp = await this.req(`/v1/batch/objects`, "POST", { objects });
    if (!resp.ok) {
      throw await this.parseError(resp, "batch_upsert");
    }
    const json = (await resp.json().catch(() => null)) as Array<{ result?: { errors?: { error?: Array<{ message?: string }> } } }> | null;
    if (Array.isArray(json)) {
      const firstErr = json.find((entry) => entry?.result?.errors?.error?.length);
      if (firstErr) {
        const msg = firstErr.result?.errors?.error?.[0]?.message ?? "batch contained errors";
        throw new VectorStoreError("weaviate", `batch_upsert partially failed: ${msg}`);
      }
    }
  }

  private async ensureClass(className: string): Promise<void> {
    const exists = await this.req(`/v1/schema/${encodeURIComponent(className)}`, "GET");
    if (exists.ok) return;
    const resp = await this.req("/v1/schema", "POST", {
      class: className,
      vectorizer: "none",
      vectorIndexConfig: this.config.dimensions ? { distance: "cosine" } : undefined,
    });
    if (!resp.ok && resp.status !== 422) {
      throw await this.parseError(resp, "create_class");
    }
  }

  private async req(path: string, method: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return fetchWithTimeout(this.fetchImpl, `${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private async parseError(resp: Response, op: string): Promise<VectorStoreError> {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const json = (await resp.json()) as { error?: Array<{ message?: string }> | string; message?: string };
      if (Array.isArray(json.error) && json.error[0]?.message) detail = json.error[0].message;
      else if (typeof json.error === "string") detail = json.error;
      else if (json.message) detail = json.message;
    } catch {
      try { detail = (await resp.text()).slice(0, 400) || detail; } catch { /* ignore */ }
    }
    return new VectorStoreError("weaviate", `${op} failed: ${detail}`, resp.status);
  }
}
