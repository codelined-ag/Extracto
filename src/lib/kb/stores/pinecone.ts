import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";
import { VectorStoreError } from "@/lib/kb/stores/error";
import { fetchWithRetry } from "@/lib/kb/stores/fetch-with-timeout";

export interface PineconeAdapterConfig {
  /** The per-index host URL (https://INDEX-PROJ.svc.REGION.pinecone.io). */
  baseUrl: string;
  apiKey: string;
  dimensions?: number;
  /** Pinecone treats namespace as logical partition; defaults to "" (the default namespace). */
  namespace?: string;
}

export class PineconeAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: PineconeAdapterConfig, fetchImpl: typeof fetch = fetch) {
    if (!config.apiKey) {
      throw new VectorStoreError("pinecone", "apiKey is required");
    }
    this.fetchImpl = fetchImpl;
    this.base = config.baseUrl.replace(/\/+$/u, "");
  }

  async collectionExists(_name: string): Promise<boolean> {
    // Pinecone scopes collections via the per-index host; the host itself
    // implicitly proves the index exists. /describe_index_stats succeeds
    // for any caller with a valid api-key against a live index.
    const resp = await this.req("/describe_index_stats", {});
    return resp.ok;
  }

  async upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void> {
    if (chunks.length === 0) return;
    const namespace = this.config.namespace ?? collectionName;
    const vectors = chunks.map((chunk) => {
      const idSource = chunk.metadata.contentHash
        ? `${chunk.metadata.jobId}:${chunk.metadata.contentHash}`
        : `${chunk.metadata.jobId}:${chunk.metadata.chunkIndex}:${chunk.metadata.pageNumber ?? 0}`;
      const metadata: Record<string, unknown> = { text: chunk.text };
      for (const [k, v] of Object.entries(chunk.metadata)) {
        if (v === undefined) continue;
        // Pinecone metadata values are limited to string/number/boolean/string[].
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          metadata[k] = v;
        } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          metadata[k] = v;
        }
      }
      return { id: idSource, values: chunk.embedding, metadata };
    });
    const resp = await this.req("/vectors/upsert", { vectors, namespace });
    if (!resp.ok) throw await this.parseError(resp, "upsert");
  }

  private async req(path: string, body: unknown): Promise<Response> {
    return fetchWithRetry(this.fetchImpl, `${this.base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Api-Key": this.config.apiKey,
      },
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
    return new VectorStoreError("pinecone", `${op} failed: ${detail}`, resp.status);
  }
}
