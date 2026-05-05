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
      template: "custom" as const,
      targetLanguage: "",
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
      postProcessingPayload: { enabled: false, outputFormat: "markdown" as const, instruction: "", model: "", template: "custom" as const, targetLanguage: "" },
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
      postProcessingPayload: { enabled: true, outputFormat: "json" as const, instruction: "extract", model: "llama-pp", template: "custom" as const, targetLanguage: "" },
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

  it("hands a translation instruction to the provider when template is 'translate'", async () => {
    mockedRun.mockResolvedValueOnce({ text: "Bonjour le monde", metadata: {} });
    const state = freshState();
    await runPostProcessingStage(
      state,
      makeDeps({
        postProcessingPayload: {
          enabled: true,
          outputFormat: "markdown",
          instruction:
            "Translate the OCR'd document into French. Preserve every heading, list, table, and code block in the same place. Do not add commentary or summarize. Output the translation only.",
          model: "openai/gpt-4o",
          template: "translate",
          targetLanguage: "French",
        },
        postProcessingModel: "openai/gpt-4o",
      }),
    );
    const call = mockedRun.mock.calls[0];
    const systemPrompt = call[3] as string;
    const userPrompt = call[4] as string;
    expect(systemPrompt).toMatch(/precise post-processing assistant/);
    expect(userPrompt).toContain("French");
    expect(userPrompt).toContain("Translate the OCR'd document");
    expect(userPrompt).toContain("Preserve every heading");
    expect(userPrompt).toContain("Output the translation only.");
  });

  it("hands a 3-sentence summary instruction when template is 'summarize-3sentence'", async () => {
    mockedRun.mockResolvedValueOnce({ text: "Three sentences.", metadata: {} });
    await runPostProcessingStage(
      freshState(),
      makeDeps({
        postProcessingPayload: {
          enabled: true,
          outputFormat: "markdown",
          instruction:
            "Summarize the OCR'd document in three sentences. Capture the main point, the supporting evidence, and any next steps the document calls for. Output the summary only.",
          model: "openai/gpt-4o",
          template: "summarize-3sentence",
          targetLanguage: "",
        },
        postProcessingModel: "openai/gpt-4o",
      }),
    );
    const userPrompt = mockedRun.mock.calls[0][4] as string;
    expect(userPrompt).toContain("three sentences");
    expect(userPrompt).toContain("main point");
  });

  it("hands an extract-actions instruction when template is 'extract-actions'", async () => {
    mockedRun.mockResolvedValueOnce({ text: "- do thing", metadata: {} });
    await runPostProcessingStage(
      freshState(),
      makeDeps({
        postProcessingPayload: {
          enabled: true,
          outputFormat: "markdown",
          instruction:
            "Extract all action items from the OCR'd document. Output as a markdown list. Each item starts with the verb, names the owner if mentioned, and includes the deadline if mentioned. If the document has no action items, output the single line: No action items found.",
          model: "openai/gpt-4o",
          template: "extract-actions",
          targetLanguage: "",
        },
        postProcessingModel: "openai/gpt-4o",
      }),
    );
    const userPrompt = mockedRun.mock.calls[0][4] as string;
    expect(userPrompt).toContain("action items");
    expect(userPrompt).toContain("No action items found");
  });

  it("uses the user's free-form instruction when template is 'custom'", async () => {
    mockedRun.mockResolvedValueOnce({ text: "anything", metadata: {} });
    await runPostProcessingStage(
      freshState(),
      makeDeps({
        postProcessingPayload: {
          enabled: true,
          outputFormat: "markdown",
          instruction: "Reformat as a CSV table",
          model: "openai/gpt-4o",
          template: "custom",
          targetLanguage: "",
        },
        postProcessingModel: "openai/gpt-4o",
      }),
    );
    const userPrompt = mockedRun.mock.calls[0][4] as string;
    expect(userPrompt).toContain("Reformat as a CSV table");
    expect(userPrompt).not.toContain("Translate");
  });
});
