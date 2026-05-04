import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { ocrJob: { update: vi.fn().mockResolvedValue({}) } },
}));

vi.mock("@/lib/ocr/ollama-dispatch", () => ({
  getOllamaCandidatesForOcr: vi.fn((endpoint: string) => [endpoint]),
}));

vi.mock("@/lib/ocr/providers/ollama", () => ({
  warmupOllamaModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ocr/provider-dispatch", () => ({
  runProviderPostProcessing: vi.fn(),
}));

import { db } from "@/lib/db";
import { warmupOllamaModel } from "@/lib/ocr/providers/ollama";
import { runProviderPostProcessing } from "@/lib/ocr/provider-dispatch";
import { runPostProcessingStage } from "@/lib/ocr/pipeline-post-processing-stage";
import type { OrchestratorState } from "@/lib/ocr/pipeline-page-loop";
import {
  buildProgressMetadata,
  type OcrProgressMetadata,
  type ProgressSnapshotInput,
} from "@/lib/ocr/pipeline-progress";

const mockedRun = runProviderPostProcessing as ReturnType<typeof vi.fn>;
const mockedWarmup = warmupOllamaModel as ReturnType<typeof vi.fn>;
const mockedDbUpdate = db.ocrJob.update as ReturnType<typeof vi.fn>;

function freshState(): OrchestratorState {
  return {
    pageOutputs: [],
    checkpoints: [],
    pageRecords: [],
    partialStructuredPages: [],
    partialPageResults: [],
    totalDurationMs: 0,
    extractedTextSoFar: "",
    extractedChunkCount: 0,
    progressEvents: [],
    latestMetadata: {} as OcrProgressMetadata,
    postProcessingMeta: { enabled: true },
    usedOllamaModels: new Set<string>(),
    degenerateRetryBudget: 10,
  };
}

function snapshotStub(snap: ProgressSnapshotInput): OcrProgressMetadata {
  return buildProgressMetadata({
    stage: snap.stage,
    message: snap.message,
    progressPct: snap.progressPct,
    pageCount: 0,
    processedPages: 0,
    currentPage: snap.currentPage ?? null,
    etaSeconds: snap.etaSeconds ?? null,
    startedAt: "2026-01-01T00:00:00Z",
    events: [],
    checkpoints: [],
    postProcessing: { enabled: true },
  });
}

function makeDeps(overrides: Partial<Parameters<typeof runPostProcessingStage>[1]> = {}) {
  return {
    jobId: "job-1",
    settings: { provider: "ollama" as const, apiEndpoint: "http://o", apiKey: "" },
    postProcessingPayload: {
      enabled: true,
      outputFormat: "markdown" as const,
      instruction: "tighten",
      model: "llama-pp",
    },
    postProcessingModel: "llama-pp",
    pageScopedText: "Page 1\n---\nfoo",
    extractedMarkdown: "raw extracted",
    snapshot: snapshotStub,
    ...overrides,
  };
}

beforeEach(() => {
  mockedRun.mockReset();
  mockedWarmup.mockReset().mockResolvedValue(undefined);
  mockedDbUpdate.mockReset().mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("runPostProcessingStage", () => {
  it("returns the raw extracted markdown when post-processing is disabled (no provider call)", async () => {
    const state = freshState();
    const out = await runPostProcessingStage(state, makeDeps({
      postProcessingPayload: { enabled: false, outputFormat: "markdown", instruction: "", model: "" },
    }));
    expect(out.finalMarkdown).toBe("raw extracted");
    expect(out.postProcessingForExtractedMetadata).toEqual({ enabled: false });
    expect(mockedRun).not.toHaveBeenCalled();
    expect(mockedWarmup).not.toHaveBeenCalled();
  });

  it("warms up Ollama and tracks the post-processing model in usedOllamaModels", async () => {
    mockedRun.mockResolvedValueOnce({ text: "polished", metadata: { tokens: 42 } });
    const state = freshState();
    await runPostProcessingStage(state, makeDeps());
    expect(mockedWarmup).toHaveBeenCalledWith(["http://o"], "llama-pp");
    expect(state.usedOllamaModels.has("llama-pp")).toBe(true);
  });

  it("replaces finalMarkdown when output format is markdown and the run succeeds", async () => {
    mockedRun.mockResolvedValueOnce({ text: "polished", metadata: {} });
    const state = freshState();
    const out = await runPostProcessingStage(state, makeDeps());
    expect(out.finalMarkdown).toBe("polished");
    expect(out.postProcessedText).toBe("polished");
    expect(state.postProcessingMeta.applied).toBe(true);
    expect(state.postProcessingMeta.error).toBeUndefined();
  });

  it("keeps the raw markdown but returns parsed JSON when output format is json", async () => {
    mockedRun.mockResolvedValueOnce({
      text: '{"title": "doc"}',
      metadata: {},
    });
    const state = freshState();
    const out = await runPostProcessingStage(state, makeDeps({
      postProcessingPayload: { enabled: true, outputFormat: "json", instruction: "extract", model: "llama-pp" },
    }));
    expect(out.finalMarkdown).toBe("raw extracted");
    expect(out.postProcessedJson).toEqual({ title: "doc" });
    expect(JSON.parse(out.postProcessedText ?? "")).toEqual({ title: "doc" });
  });

  it("captures provider errors as a non-fatal metadata note (does not throw)", async () => {
    mockedRun.mockRejectedValueOnce(new Error("provider 502"));
    const state = freshState();
    const out = await runPostProcessingStage(state, makeDeps());
    expect(out.finalMarkdown).toBe("raw extracted");
    expect(out.postProcessedText).toBeUndefined();
    expect(state.postProcessingMeta.applied).toBe(false);
    expect(state.postProcessingMeta.error).toMatch(/provider 502/);
  });

  it("merges provider-returned metadata into the extractedMetadata.postProcessing payload", async () => {
    mockedRun.mockResolvedValueOnce({
      text: "polished",
      metadata: { tokens: 1234, latencyMs: 50 },
    });
    const state = freshState();
    const out = await runPostProcessingStage(state, makeDeps());
    expect(out.postProcessingForExtractedMetadata).toMatchObject({
      enabled: true,
      applied: true,
      tokens: 1234,
      latencyMs: 50,
    });
  });
});
