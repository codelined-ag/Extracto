import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";
import { VectorStoreError } from "@/lib/kb/stores/error";
import { fetchWithTimeout } from "@/lib/kb/stores/fetch-with-timeout";

export interface OpenSearchAdapterConfig {
  baseUrl: string;
  /** Bearer/API-key (sent as Authorization). */
  apiKey?: string;
  /** Optional basic-auth user:pass — used if `apiKey` is not set. */
  basicAuth?: string;
  dimensions?: number;
  /** Defaults to "cosinesimil"; OpenSearch also supports "l2", "innerproduct". */
  spaceType?: "cosinesimil" | "l2" | "innerproduct";
}

export class OpenSearchAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: OpenSearchAdapterConfig, fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
    this.base = config.baseUrl.replace(/\/+$/u, "");
  }

  async collectionExists(name: string): Promise<boolean> {
    const resp = await this.req(`/${encodeURIComponent(this.normalizeIndexName(name))}`, "HEAD");
    return resp.ok;
  }

  private normalizeIndexName(name: string): string {
    return name.toLowerCase().replace(/^[_-]+/, "").replace(/[^a-z0-9_\-.]/g, "-");
  }

  async upsert(chunks: Array<Chunk & { embedding: number[] }>, collectionName: string): Promise<void> {
    if (chunks.length === 0) return;
    const indexName = this.normalizeIndexName(collectionName);
    await this.ensureIndex(indexName, chunks[0].embedding.length);

    const lines: string[] = [];
    for (const chunk of chunks) {
      const idSource = chunk.metadata.contentHash
        ? `${chunk.metadata.jobId}:${chunk.metadata.contentHash}`
        : `${chunk.metadata.jobId}:${chunk.metadata.chunkIndex}:${chunk.metadata.pageNumber ?? 0}`;
      lines.push(JSON.stringify({ index: { _index: indexName, _id: idSource } }));
      const doc: Record<string, unknown> = { text: chunk.text, vector: chunk.embedding };
      for (const [k, v] of Object.entries(chunk.metadata)) {
        if (v === undefined) continue;
        doc[k] = v;
      }
      lines.push(JSON.stringify(doc));
    }
    const body = lines.join("\n") + "\n";
    const headers: Record<string, string> = { "Content-Type": "application/x-ndjson", Accept: "application/json" };
    this.applyAuth(headers);
    const resp = await fetchWithTimeout(this.fetchImpl, `${this.base}/_bulk`, {
      method: "POST",
      headers,
      body,
    });
    if (!resp.ok) throw await this.parseError(resp, "bulk");
    const json = (await resp.json().catch(() => null)) as
      | {
          errors?: boolean;
          items?: Array<Record<string, { _id?: string; status?: number; error?: { type?: string; reason?: string } }>>;
        }
      | null;
    if (json?.errors) {
      const failures: string[] = [];
      for (const item of json.items ?? []) {
        const op = Object.values(item)[0];
        if (op?.error) {
          const id = op._id ? `${op._id}: ` : "";
          const detail = op.error.reason ?? op.error.type ?? `status ${op.status ?? "?"}`;
          failures.push(`${id}${detail}`);
          if (failures.length >= 3) break;
        }
      }
      const summary = failures.length > 0 ? ` — ${failures.join("; ")}` : "";
      const failingCount = (json.items ?? []).filter((i) => Object.values(i)[0]?.error).length;
      throw new VectorStoreError(
        "opensearch",
        `bulk reported errors on ${failingCount} item(s)${summary}`,
        resp.status,
      );
    }
  }

  private async ensureIndex(name: string, vectorSize: number): Promise<void> {
    if (await this.collectionExists(name)) return;
    const dimension = this.config.dimensions ?? vectorSize;
    const resp = await this.req(`/${encodeURIComponent(name)}`, "PUT", {
      settings: { index: { knn: true } },
      mappings: {
        properties: {
          vector: {
            type: "knn_vector",
            dimension,
            method: { name: "hnsw", space_type: this.config.spaceType ?? "cosinesimil", engine: "lucene" },
          },
          text: { type: "text" },
        },
      },
    });
    if (!resp.ok && resp.status !== 400) throw await this.parseError(resp, "create_index");
  }

  private async req(path: string, method: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    this.applyAuth(headers);
    return fetchWithTimeout(this.fetchImpl, `${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private applyAuth(headers: Record<string, string>): void {
    if (this.config.apiKey) {
      headers.Authorization = `ApiKey ${this.config.apiKey}`;
    } else if (this.config.basicAuth) {
      headers.Authorization = `Basic ${Buffer.from(this.config.basicAuth, "utf8").toString("base64")}`;
    }
  }

  private async parseError(resp: Response, op: string): Promise<VectorStoreError> {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const json = (await resp.json()) as { error?: { type?: string; reason?: string } | string };
      if (typeof json.error === "string") detail = json.error;
      else if (json.error) detail = `${json.error.type ?? "error"}: ${json.error.reason ?? ""}`;
    } catch {
      try { detail = (await resp.text()).slice(0, 400) || detail; } catch { /* ignore */ }
    }
    return new VectorStoreError("opensearch", `${op} failed: ${detail}`, resp.status);
  }
}
