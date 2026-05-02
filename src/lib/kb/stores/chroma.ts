// Chroma vector store adapter.
//
// Talks to a Chroma server's REST API (default :8000) without the official
// chromadb client to keep the dependency footprint small. Implements the
// shared VectorStoreAdapter contract; fetch is injectable for testability.
//
// Chroma REST endpoints we use (v1):
//   GET    /api/v1/collections/<name>          — collectionExists check
//   POST   /api/v1/collections                 — get-or-create collection
//   POST   /api/v1/collections/<id>/upsert     — push documents+embeddings

import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";

export interface ChromaAdapterConfig {
  baseUrl: string;
  /** Optional: forwarded as Authorization: Bearer for proxied/protected setups. */
  apiKey?: string;
  /** Vector dimensionality, used at create time. */
  dimensions?: number;
}

const REQUEST_TIMEOUT_MS = 60_000;

export class ChromaAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(
    private readonly config: ChromaAdapterConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
    this.base = config.baseUrl.replace(/\/+$/u, "");
  }

  async collectionExists(name: string): Promise<boolean> {
    const resp = await this.req(`/api/v1/collections/${encodeURIComponent(name)}`, "GET");
    return resp.ok;
  }

  async upsert(
    chunks: Array<Chunk & { embedding: number[] }>,
    collectionName: string,
  ): Promise<void> {
    if (chunks.length === 0) return;
    const collectionId = await this.getOrCreateCollection(collectionName);

    const ids: string[] = [];
    const documents: string[] = [];
    const embeddings: number[][] = [];
    const metadatas: Array<Record<string, unknown>> = [];

    for (const chunk of chunks) {
      const id = this.computeId(chunk);
      ids.push(id);
      documents.push(chunk.text);
      embeddings.push(chunk.embedding);
      // Chroma metadata only accepts string|number|boolean|null at top level —
      // flatten the nested ChunkMetadata to a single level by JSON-stringifying
      // anything else. Skip undefined values entirely.
      const flat: Record<string, string | number | boolean | null> = {};
      for (const [k, v] of Object.entries(chunk.metadata)) {
        if (v === undefined) continue;
        if (
          typeof v === "string" ||
          typeof v === "number" ||
          typeof v === "boolean" ||
          v === null
        ) {
          flat[k] = v;
        } else {
          flat[k] = JSON.stringify(v);
        }
      }
      metadatas.push(flat);
    }

    const resp = await this.req(
      `/api/v1/collections/${collectionId}/upsert`,
      "POST",
      { ids, documents, embeddings, metadatas },
    );
    if (!resp.ok) {
      throw await this.parseChromaError(resp, "upsert");
    }
  }

  private computeId(chunk: Chunk & { embedding: number[] }): string {
    // Prefer contentHash when caller computed one; otherwise build a stable
    // composite from jobId + chunkIndex (+ pageNumber if present).
    if (chunk.metadata.contentHash) {
      return `${chunk.metadata.jobId}-${chunk.metadata.contentHash.slice(0, 16)}`;
    }
    if (chunk.metadata.pageNumber != null) {
      return `${chunk.metadata.jobId}-p${chunk.metadata.pageNumber}-c${chunk.metadata.chunkIndex}`;
    }
    return `${chunk.metadata.jobId}-c${chunk.metadata.chunkIndex}`;
  }

  private async getOrCreateCollection(name: string): Promise<string> {
    // POST /api/v1/collections is a get-or-create when get_or_create=true.
    const body: Record<string, unknown> = { name, get_or_create: true };
    if (this.config.dimensions) {
      body.metadata = { dimension: this.config.dimensions };
    }
    const resp = await this.req("/api/v1/collections", "POST", body);
    if (!resp.ok) {
      throw await this.parseChromaError(resp, "get_or_create_collection");
    }
    const json = (await resp.json()) as { id?: string; name?: string };
    if (typeof json.id !== "string") {
      throw new VectorStoreError(
        "chroma",
        "get_or_create_collection: response missing id",
        resp.status,
      );
    }
    return json.id;
  }

  private async req(path: string, method: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseChromaError(resp: Response, op: string): Promise<VectorStoreError> {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const json = (await resp.json()) as { error?: string; detail?: string };
      detail = json.error ?? json.detail ?? detail;
    } catch {
      /* response wasn't JSON */
    }
    return new VectorStoreError("chroma", `${op} failed: ${detail}`, resp.status);
  }
}

/**
 * Symmetric typed error for vector-store failures — mirrors EmbeddingError
 * from lib/kb/embedding.ts so callers can catch a single shape and read
 * provider + status without parsing the message.
 */
export class VectorStoreError extends Error {
  constructor(
    public readonly store: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`${store}: ${message}`);
    this.name = "VectorStoreError";
  }
}
