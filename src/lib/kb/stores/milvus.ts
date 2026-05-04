import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";
import { VectorStoreError } from "@/lib/kb/stores/error";
import { fetchWithTimeout } from "@/lib/kb/stores/fetch-with-timeout";

export interface MilvusAdapterConfig {
  baseUrl: string;
  apiKey?: string;
  dimensions?: number;
  metricType?: "L2" | "IP" | "COSINE";
  dbName?: string;
}

export class MilvusAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: MilvusAdapterConfig, fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
    this.base = config.baseUrl.replace(/\/+$/u, "");
  }

  async collectionExists(name: string): Promise<boolean> {
    const resp = await this.req("/v2/vectordb/collections/has", { collectionName: name });
    if (!resp.ok) return false;
    const json = (await resp.json().catch(() => null)) as { data?: { has?: boolean } } | null;
    return Boolean(json?.data?.has);
  }

  async upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void> {
    if (chunks.length === 0) return;
    await this.ensureCollection(collectionName, chunks[0].embedding.length);
    const data = chunks.map((chunk) => {
      const idSource = chunk.metadata.contentHash
        ? `${chunk.metadata.jobId}:${chunk.metadata.contentHash}`
        : `${chunk.metadata.jobId}:${chunk.metadata.chunkIndex}:${chunk.metadata.pageNumber ?? 0}`;
      const meta: Record<string, unknown> = { text: chunk.text };
      for (const [k, v] of Object.entries(chunk.metadata)) {
        if (v === undefined) continue;
        meta[k] = v;
      }
      return { id: idSource, vector: chunk.embedding, ...meta };
    });
    const resp = await this.req("/v2/vectordb/entities/upsert", { collectionName, data });
    if (!resp.ok) throw await this.parseError(resp, "upsert");
    const json = (await resp.json().catch(() => null)) as { code?: number; message?: string } | null;
    if (json && typeof json.code === "number" && json.code !== 0) {
      throw new VectorStoreError("milvus", `upsert failed: ${json.message ?? `code ${json.code}`}`, resp.status);
    }
  }

  private async ensureCollection(name: string, vectorSize: number): Promise<void> {
    if (await this.collectionExists(name)) return;
    const resp = await this.req("/v2/vectordb/collections/create", {
      collectionName: name,
      dimension: this.config.dimensions ?? vectorSize,
      metricType: this.config.metricType ?? "COSINE",
      autoId: false,
      primaryFieldName: "id",
      idType: "VarChar",
      vectorFieldName: "vector",
      params: { max_length: 512 },
    });
    if (!resp.ok && resp.status !== 409) throw await this.parseError(resp, "create_collection");
    const json = (await resp.json().catch(() => null)) as { code?: number; message?: string } | null;
    if (json && typeof json.code === "number" && json.code !== 0) {
      throw new VectorStoreError(
        "milvus",
        `create_collection failed: ${json.message ?? `code ${json.code}`}`,
        resp.status,
      );
    }
  }

  private async req(path: string, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    if (this.config.dbName) headers.dbName = this.config.dbName;
    return fetchWithTimeout(this.fetchImpl, `${this.base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  private async parseError(resp: Response, op: string): Promise<VectorStoreError> {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const json = (await resp.json()) as { message?: string; error?: string };
      detail = json.message ?? json.error ?? detail;
    } catch {
      try { detail = (await resp.text()).slice(0, 400) || detail; } catch { /* ignore */ }
    }
    return new VectorStoreError("milvus", `${op} failed: ${detail}`, resp.status);
  }
}
