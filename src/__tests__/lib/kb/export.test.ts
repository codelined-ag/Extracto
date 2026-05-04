import { describe, it, expect, vi } from "vitest";

// Stub embedTexts so we don't need a real provider.
vi.mock("@/lib/kb/embedding", () => ({
  embedTexts: vi.fn(),
}));

import { embedTexts } from "@/lib/kb/embedding";
import { runKbExport } from "@/lib/kb/export";
import type { ChunkingOptions, EmbeddingProviderConfig, VectorStoreAdapter, Chunk } from "@/lib/kb/types";

function makeStore(): VectorStoreAdapter & {
  collections: Set<string>;
  upserted: Array<{ collection: string; chunks: Array<Chunk & { embedding: number[] }> }>;
} {
  const collections = new Set<string>();
  const upserted: Array<{ collection: string; chunks: Array<Chunk & { embedding: number[] }> }> = [];
  return {
    collections,
    upserted,
    async collectionExists(name) {
      return collections.has(name);
    },
    async upsert(chunks, collection) {
      collections.add(collection);
      upserted.push({ collection, chunks });
    },
  };
}

const baseInput = {
  jobId: "job-1",
  fileName: "doc.pdf",
  extractedAt: "2026-05-02T00:00:00.000Z",
  chunking: { strategy: "fixed", maxChunkSize: 5, overlap: 0 } as ChunkingOptions,
  embedding: {
    provider: "ollama",
    apiEndpoint: "http://127.0.0.1:11434",
    model: "nomic-embed-text",
  } as EmbeddingProviderConfig,
  collectionName: "kb-1",
};

describe("runKbExport", () => {
  it("returns chunkCount=0 and skips embedding when source is empty", async () => {
    const store = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    const result = await runKbExport({ ...baseInput, extractedText: "", store });
    expect(result.chunkCount).toBe(0);
    expect(result.embeddingDimensions).toBe(null);
    expect(embedTexts).not.toHaveBeenCalled();
    expect(store.upserted).toHaveLength(0);
  });

  it("chunks text, embeds once, and upserts to the store", async () => {
    const store = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    (embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);

    const result = await runKbExport({
      ...baseInput,
      extractedText: "abcdefghij", // length 10, max=5 -> 2 chunks
      store,
    });

    expect(result.chunkCount).toBe(2);
    expect(result.embeddingDimensions).toBe(3);
    expect(embedTexts).toHaveBeenCalledTimes(1);
    expect(embedTexts).toHaveBeenCalledWith(["abcde", "fghij"], baseInput.embedding, fetch, { concurrency: undefined });
    expect(store.upserted).toHaveLength(1);
    expect(store.upserted[0].collection).toBe("kb-1");
    expect(store.upserted[0].chunks).toHaveLength(2);
  });

  it("attaches per-chunk metadata (chunkIndex, chunkOf, strategy, contentHash)", async () => {
    const store = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    (embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[0], [0]]);

    await runKbExport({
      ...baseInput,
      extractedText: "abcdefghij",
      store,
    });

    const c0 = store.upserted[0].chunks[0];
    expect(c0.metadata.jobId).toBe("job-1");
    expect(c0.metadata.fileName).toBe("doc.pdf");
    expect(c0.metadata.chunkIndex).toBe(0);
    expect(c0.metadata.chunkOf).toBe(2);
    expect(c0.metadata.strategy).toBe("fixed");
    expect(c0.metadata.extractedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(typeof c0.metadata.contentHash).toBe("string");
    expect(c0.metadata.contentHash).toHaveLength(64); // sha256 hex
  });

  it("includes optional source model and language when provided", async () => {
    const store = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    (embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    await runKbExport({
      ...baseInput,
      extractedText: "x",
      sourceModel: "mistral-ocr-latest",
      language: "en",
      store,
    });

    expect(store.upserted[0].chunks[0].metadata.model).toBe("mistral-ocr-latest");
    expect(store.upserted[0].chunks[0].metadata.language).toBe("en");
  });

  it("computes deterministic contentHash from chunk text", async () => {
    const store1 = makeStore();
    const store2 = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    (embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);

    await runKbExport({ ...baseInput, extractedText: "hello", store: store1 });
    (embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);
    await runKbExport({ ...baseInput, extractedText: "hello", store: store2 });

    const h1 = store1.upserted[0].chunks[0].metadata.contentHash;
    const h2 = store2.upserted[0].chunks[0].metadata.contentHash;
    expect(h1).toBe(h2);
    expect(h1).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"); // sha256("hello")
  });

  it("throws when embedding length mismatches chunk count", async () => {
    const store = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    (embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[0.1]]); // only 1 vector

    await expect(
      runKbExport({ ...baseInput, extractedText: "abcdefghij", store }),
    ).rejects.toThrow(/1 vectors for 2 chunks/);

    expect(store.upserted).toHaveLength(0); // upsert never reached
  });

  it("propagates embedding failures without calling store.upsert", async () => {
    const store = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    (embedTexts as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("embed failed"));

    await expect(
      runKbExport({ ...baseInput, extractedText: "abcde", store }),
    ).rejects.toThrow("embed failed");
    expect(store.upserted).toHaveLength(0);
  });

  it("propagates store failures", async () => {
    const store = makeStore();
    (embedTexts as ReturnType<typeof vi.fn>).mockReset();
    (embedTexts as ReturnType<typeof vi.fn>).mockResolvedValue([[1]]);
    store.upsert = async () => {
      throw new Error("chroma down");
    };

    await expect(
      runKbExport({ ...baseInput, extractedText: "x", store }),
    ).rejects.toThrow("chroma down");
  });
});
