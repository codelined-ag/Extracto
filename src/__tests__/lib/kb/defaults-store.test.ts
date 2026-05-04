import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let workdir = "";

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "kb-defaults-"));
  vi.stubEnv("DATABASE_URL", `file:${path.join(workdir, "test.db")}`);
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workdir, { recursive: true, force: true });
});

async function loadModule() {
  return import("@/lib/kb/defaults-store");
}

describe("getKbDefaults", () => {
  it("returns built-in defaults when no file exists", async () => {
    const m = await loadModule();
    const d = await m.getKbDefaults("user1");
    expect(d.embedding.provider).toBe("ollama");
    expect(d.embedding.model).toBe("nomic-embed-text");
    expect(d.chunking.strategy).toBe("paragraph");
    expect(d.vectorStore.kind).toBe("chroma");
    expect(d.collectionNameTemplate).toBe("extracto-{jobId}");
  });

  it("sanitizes the userId for the filename", async () => {
    const m = await loadModule();
    const a = await m.getKbDefaults("user 1/with::weird");
    expect(a).toBeDefined();
  });
});

describe("saveKbDefaults", () => {
  it("persists embedding + chunking + vector store and read-back equals saved values", async () => {
    const m = await loadModule();
    const saved = await m.saveKbDefaults("user1", {
      embedding: { provider: "openai_compat", apiEndpoint: "https://api.openai.com/v1", model: "text-embed-3", dimensions: 1536 },
      chunking: { strategy: "fixed", maxChunkSize: 500, overlap: 50 },
      vectorStore: { kind: "qdrant", baseUrl: "http://127.0.0.1:6333", dimensions: 1536 },
      collectionNameTemplate: "{fileName}-vectors",
    });
    expect(saved.embedding.provider).toBe("openai_compat");
    expect(saved.chunking.maxChunkSize).toBe(500);
    expect(saved.vectorStore.kind).toBe("qdrant");

    const m2 = await loadModule();
    const loaded = await m2.getKbDefaults("user1");
    expect(loaded.embedding.model).toBe("text-embed-3");
    expect(loaded.vectorStore.baseUrl).toBe("http://127.0.0.1:6333");
    expect(loaded.collectionNameTemplate).toBe("{fileName}-vectors");
  });

  it("only replaces apiKey when replaceApiKey flag is set", async () => {
    const m = await loadModule();
    await m.saveKbDefaults("user1", {
      embedding: { apiKey: "first", replaceApiKey: true },
      vectorStore: { apiKey: "store-first", replaceApiKey: true },
    });
    await m.saveKbDefaults("user1", {
      embedding: { apiKey: "ignored-no-flag" },
      vectorStore: { apiKey: "ignored-no-flag" },
    });
    const reloaded = await m.getKbDefaults("user1");
    expect(reloaded.embedding.apiKey).toBe("first");
    expect(reloaded.vectorStore.apiKey).toBe("store-first");
  });

  it("ignores invalid kind and falls back to current", async () => {
    const m = await loadModule();
    await m.saveKbDefaults("user1", { vectorStore: { kind: "qdrant", baseUrl: "http://localhost:6333" } });
    const after = await m.saveKbDefaults("user1", { vectorStore: { kind: "junk" as never } });
    expect(after.vectorStore.kind).toBe("qdrant");
  });

  it("clamps invalid dimensions to defaults", async () => {
    const m = await loadModule();
    const saved = await m.saveKbDefaults("user1", {
      embedding: { dimensions: -5 as unknown as number },
    });
    expect(saved.embedding.dimensions).toBe(768);
  });
});

describe("toClientKbDefaults", () => {
  it("strips apiKey and sets hasApiKey flags", async () => {
    const m = await loadModule();
    await m.saveKbDefaults("user1", {
      embedding: { apiKey: "secret", replaceApiKey: true },
      vectorStore: { apiKey: "", replaceApiKey: true },
    });
    const d = await m.getKbDefaults("user1");
    const client = m.toClientKbDefaults(d);
    expect((client.embedding as Record<string, unknown>).apiKey).toBeUndefined();
    expect(client.embedding.hasApiKey).toBe(true);
    expect(client.vectorStore.hasApiKey).toBe(false);
  });
});

describe("renderCollectionName", () => {
  it("substitutes {jobId} and {fileName}", async () => {
    const m = await loadModule();
    expect(m.renderCollectionName("foo-{jobId}-{fileName}", "j123", "doc.pdf")).toBe("foo-j123-doc");
  });

  it("strips invalid Chroma characters", async () => {
    const m = await loadModule();
    const out = m.renderCollectionName("hi there!{jobId}", "abc", "x.pdf");
    expect(out).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it("pads names shorter than 3 chars", async () => {
    const m = await loadModule();
    const out = m.renderCollectionName("a", "x", "y.pdf");
    expect(out.length).toBeGreaterThanOrEqual(3);
  });
});

describe("defaultBaseUrlForStoreKind", () => {
  it("returns the per-kind defaults", async () => {
    const m = await loadModule();
    expect(m.defaultBaseUrlForStoreKind("chroma")).toBe("http://127.0.0.1:8000");
    expect(m.defaultBaseUrlForStoreKind("qdrant")).toBe("http://127.0.0.1:6333");
    expect(m.defaultBaseUrlForStoreKind("weaviate")).toBe("http://127.0.0.1:8080");
  });
});
