import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";
import { VectorStoreError } from "@/lib/kb/stores/error";
import { fetchWithTimeout } from "@/lib/kb/stores/fetch-with-timeout";

export interface QdrantAdapterConfig {
  baseUrl: string;
  apiKey?: string;
  dimensions?: number;
  distance?: "Cosine" | "Euclid" | "Dot";
}

function uuidFromString(input: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1b873593, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ c) + h1, 0x5bd1e995) >>> 0;
    h3 = Math.imul((h3 ^ c) ^ h2, 0xc6a4a793) >>> 0;
    h4 = Math.imul((h4 ^ c) ^ h3, 0x52dce729) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const raw = (hex(h1) + hex(h2) + hex(h3) + hex(h4)).slice(0, 32);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

export class QdrantAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: QdrantAdapterConfig, fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
    this.base = config.baseUrl.replace(/\/+$/u, "");
  }

  async collectionExists(name: string): Promise<boolean> {
    const resp = await this.req(`/collections/${encodeURIComponent(name)}`, "GET");
    return resp.ok;
  }

  async upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void> {
    if (chunks.length === 0) return;
    await this.ensureCollection(collectionName, chunks[0].embedding.length);
    const points = chunks.map((chunk) => {
      const idSource = chunk.metadata.contentHash
        ? `${chunk.metadata.jobId}:${chunk.metadata.contentHash}`
        : `${chunk.metadata.jobId}:${chunk.metadata.chunkIndex}:${chunk.metadata.pageNumber ?? 0}`;
      const payload: Record<string, unknown> = { text: chunk.text };
      for (const [k, v] of Object.entries(chunk.metadata)) {
        if (v === undefined) continue;
        payload[k] = v;
      }
      return { id: uuidFromString(idSource), vector: chunk.embedding, payload };
    });
    const resp = await this.req(
      `/collections/${encodeURIComponent(collectionName)}/points?wait=true`,
      "PUT",
      { points },
    );
    if (!resp.ok) {
      throw await this.parseError(resp, "upsert");
    }
  }

  private async ensureCollection(name: string, vectorSize: number): Promise<void> {
    if (await this.collectionExists(name)) return;
    const resp = await this.req(`/collections/${encodeURIComponent(name)}`, "PUT", {
      vectors: {
        size: this.config.dimensions ?? vectorSize,
        distance: this.config.distance ?? "Cosine",
      },
    });
    if (!resp.ok && resp.status !== 409) {
      throw await this.parseError(resp, "create_collection");
    }
  }

  private async req(path: string, method: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.config.apiKey) headers["api-key"] = this.config.apiKey;
    return fetchWithTimeout(this.fetchImpl, `${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private async parseError(resp: Response, op: string): Promise<VectorStoreError> {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const json = (await resp.json()) as { status?: { error?: string }; error?: string };
      detail = json.status?.error ?? json.error ?? detail;
    } catch {
      try { detail = (await resp.text()).slice(0, 400) || detail; } catch { /* ignore */ }
    }
    return new VectorStoreError("qdrant", `${op} failed: ${detail}`, resp.status);
  }
}

