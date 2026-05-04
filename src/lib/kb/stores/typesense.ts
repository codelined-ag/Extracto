import type { Chunk, VectorStoreAdapter } from "@/lib/kb/types";
import { VectorStoreError } from "@/lib/kb/stores/error";
import { fetchWithTimeout } from "@/lib/kb/stores/fetch-with-timeout";

export interface TypesenseAdapterConfig {
  baseUrl: string;
  apiKey: string;
  dimensions?: number;
}

export class TypesenseAdapter implements VectorStoreAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: TypesenseAdapterConfig, fetchImpl: typeof fetch = fetch) {
    if (!config.apiKey) {
      throw new VectorStoreError("typesense", "apiKey is required");
    }
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

    const lines: string[] = [];
    for (const chunk of chunks) {
      const idSource = chunk.metadata.contentHash
        ? `${chunk.metadata.jobId}:${chunk.metadata.contentHash}`
        : `${chunk.metadata.jobId}:${chunk.metadata.chunkIndex}:${chunk.metadata.pageNumber ?? 0}`;
      const doc: Record<string, unknown> = {
        id: idSource,
        text: chunk.text,
        embedding: chunk.embedding,
      };
      for (const [k, v] of Object.entries(chunk.metadata)) {
        if (v === undefined) continue;
        if (k === "headingPath" && Array.isArray(v)) {
          doc[k] = v.filter((x) => typeof x === "string");
        } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          doc[k] = v;
        }
      }
      lines.push(JSON.stringify(doc));
    }

    const path = `/collections/${encodeURIComponent(collectionName)}/documents/import?action=upsert`;
    const resp = await this.req(path, "POST", lines.join("\n"), "application/x-jsonl");
    if (!resp.ok) {
      throw await this.parseError(resp, "upsert");
    }

    const body = await resp.text();
    const failures: string[] = [];
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { success?: boolean; error?: string; document?: { id?: string } };
        if (parsed.success === false) {
          failures.push(`${parsed.document?.id ?? "?"}: ${parsed.error ?? "unknown"}`);
        }
      } catch {
        failures.push(trimmed.slice(0, 200));
      }
    }
    if (failures.length > 0) {
      throw new VectorStoreError(
        "typesense",
        `upsert reported errors (${failures.length}/${chunks.length}): ${failures.slice(0, 3).join("; ")}`,
        207,
      );
    }
  }

  private async ensureCollection(name: string, vectorSize: number): Promise<void> {
    if (await this.collectionExists(name)) return;
    const schema = {
      name,
      fields: [
        { name: "text", type: "string" },
        { name: "embedding", type: "float[]", num_dim: this.config.dimensions ?? vectorSize },
        { name: "jobId", type: "string", facet: true, optional: true },
        { name: "fileName", type: "string", optional: true },
        { name: "pageNumber", type: "int32", optional: true },
        { name: "chunkIndex", type: "int32", optional: true },
        { name: "language", type: "string", facet: true, optional: true },
        { name: "model", type: "string", facet: true, optional: true },
      ],
    };
    const resp = await this.req("/collections", "POST", schema);
    if (!resp.ok && resp.status !== 409) {
      throw await this.parseError(resp, "create_collection");
    }
  }

  private async req(
    path: string,
    method: string,
    body?: unknown,
    contentType = "application/json",
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-TYPESENSE-API-KEY": this.config.apiKey,
    };
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = contentType;
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    return fetchWithTimeout(this.fetchImpl, `${this.base}${path}`, { method, headers, body: payload });
  }

  private async parseError(resp: Response, op: string): Promise<VectorStoreError> {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const json = (await resp.json()) as { message?: string };
      detail = json.message ?? detail;
    } catch {
      try { detail = (await resp.text()).slice(0, 400) || detail; } catch { /* ignore */ }
    }
    return new VectorStoreError("typesense", `${op} failed: ${detail}`, resp.status);
  }
}
