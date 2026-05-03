import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";
import { VectorStoreError } from "@/lib/kb/stores/error";
import { fetchWithTimeout } from "@/lib/kb/stores/fetch-with-timeout";

export type ChromaApiVersion = "auto" | "v1" | "v2";

export interface ChromaAdapterConfig {
  baseUrl: string;
  apiKey?: string;
  dimensions?: number;
  apiVersion?: ChromaApiVersion;
  tenant?: string;
  database?: string;
}

const DEFAULT_TENANT = "default_tenant";
const DEFAULT_DATABASE = "default_database";

export class ChromaAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly tenant: string;
  private readonly database: string;
  private resolvedVersion: "v1" | "v2" | null = null;

  constructor(
    private readonly config: ChromaAdapterConfig,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl;
    this.base = config.baseUrl.replace(/\/+$/u, "");
    this.tenant = config.tenant ?? DEFAULT_TENANT;
    this.database = config.database ?? DEFAULT_DATABASE;
    if (config.apiVersion === "v1" || config.apiVersion === "v2") {
      this.resolvedVersion = config.apiVersion;
    }
  }

  async collectionExists(name: string): Promise<boolean> {
    const version = await this.resolveVersion();
    const resp = await this.req(`${this.collectionsPath(version)}/${encodeURIComponent(name)}`, "GET");
    return resp.ok;
  }

  async upsert(
    chunks: Array<Chunk & { embedding: number[] }>,
    collectionName: string,
  ): Promise<void> {
    if (chunks.length === 0) return;
    const version = await this.resolveVersion();
    const collectionId = await this.getOrCreateCollection(version, collectionName);

    const ids: string[] = [];
    const documents: string[] = [];
    const embeddings: number[][] = [];
    const metadatas: Array<Record<string, unknown>> = [];

    for (const chunk of chunks) {
      const id = this.computeId(chunk);
      ids.push(id);
      documents.push(chunk.text);
      embeddings.push(chunk.embedding);
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
      `${this.collectionsPath(version)}/${collectionId}/upsert`,
      "POST",
      { ids, documents, embeddings, metadatas },
    );
    if (!resp.ok) {
      throw await this.parseChromaError(resp, "upsert");
    }
  }

  private collectionsPath(version: "v1" | "v2"): string {
    if (version === "v2") {
      return `/api/v2/tenants/${encodeURIComponent(this.tenant)}/databases/${encodeURIComponent(this.database)}/collections`;
    }
    return "/api/v1/collections";
  }

  private async resolveVersion(): Promise<"v1" | "v2"> {
    if (this.resolvedVersion) return this.resolvedVersion;
    const v2 = await this.tryHeartbeat("v2");
    if (v2) {
      this.resolvedVersion = "v2";
      return "v2";
    }
    const v1 = await this.tryHeartbeat("v1");
    if (v1) {
      this.resolvedVersion = "v1";
      return "v1";
    }
    throw new VectorStoreError(
      "chroma",
      `unable to resolve Chroma API version: neither /api/v2/heartbeat nor /api/v1/heartbeat responded successfully at ${this.base}`,
    );
  }

  private async tryHeartbeat(version: "v1" | "v2"): Promise<boolean> {
    try {
      const resp = await this.req(`/api/${version}/heartbeat`, "GET");
      return resp.ok;
    } catch {
      return false;
    }
  }

  private computeId(chunk: Chunk & { embedding: number[] }): string {
    if (chunk.metadata.contentHash) {
      return `${chunk.metadata.jobId}-${chunk.metadata.contentHash.slice(0, 16)}`;
    }
    if (chunk.metadata.pageNumber != null) {
      return `${chunk.metadata.jobId}-p${chunk.metadata.pageNumber}-c${chunk.metadata.chunkIndex}`;
    }
    return `${chunk.metadata.jobId}-c${chunk.metadata.chunkIndex}`;
  }

  private async getOrCreateCollection(version: "v1" | "v2", name: string): Promise<string> {
    const body: Record<string, unknown> = { name, get_or_create: true };
    if (this.config.dimensions) {
      body.metadata = { dimension: this.config.dimensions };
    }
    const resp = await this.req(this.collectionsPath(version), "POST", body);
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
    return fetchWithTimeout(this.fetchImpl, `${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private async parseChromaError(resp: Response, op: string): Promise<VectorStoreError> {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const json = (await resp.json()) as { error?: string; detail?: string };
      detail = json.error ?? json.detail ?? detail;
    } catch {
      void 0;
    }
    return new VectorStoreError("chroma", `${op} failed: ${detail}`, resp.status);
  }
}

export { VectorStoreError } from "@/lib/kb/stores/error";
