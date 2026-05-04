import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    ocrJob: { update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/ocr/job-control", () => ({
  isOcrJobStopRequested: vi.fn(),
  registerOcrJobAbortController: vi.fn(),
  unregisterOcrJobAbortController: vi.fn(),
}));

vi.mock("@/lib/ocr/provider-dispatch", () => ({
  runProviderOcr: vi.fn(),
}));

import { db } from "@/lib/db";
import { isOcrJobStopRequested } from "@/lib/ocr/job-control";
import { runProviderOcr } from "@/lib/ocr/provider-dispatch";
import { runOcrPages, type OrchestratorState } from "@/lib/ocr/pipeline-page-loop";
import { OcrStopRequestedError } from "@/lib/ocr/providers/shared";
import {
  buildProgressMetadata,
  type OcrProgressMetadata,
  type ProgressSnapshotInput,
} from "@/lib/ocr/pipeline-progress";

const mockedIsStopRequested = isOcrJobStopRequested as ReturnType<typeof vi.fn>;
const mockedRunProvider = runProviderOcr as ReturnType<typeof vi.fn>;
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
    postProcessingMeta: { enabled: false },
    usedOllamaModels: new Set<string>(),
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
    postProcessing: { enabled: false },
  });
}

function makeDeps(overrides: Partial<Parameters<typeof runOcrPages>[1]> = {}) {
  return {
    jobId: "job-1",
    provider: "ollama" as const,
    settings: { provider: "ollama" as const, apiEndpoint: "http://o", apiKey: "" },
    ocrModel: "llama-vision",
    prompt: "extract",
    inputPreviews: ["data:image/png;base64,p1", "data:image/png;base64,p2"],
    startIndex: 0,
    snapshot: snapshotStub,
    ocrPct: () => 50,
    pauseAtCheckpoint: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  mockedIsStopRequested.mockReset().mockResolvedValue(false);
  mockedRunProvider.mockReset();
  mockedDbUpdate.mockReset().mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("runOcrPages", () => {
  it("processes every page from startIndex and updates state in place", async () => {
    mockedRunProvider
      .mockResolvedValueOnce({ text: "page 1", structured: { markdown: "page 1" }, metadata: { src: "ollama" } })
      .mockResolvedValueOnce({ text: "page 2", structured: { markdown: "page 2" }, metadata: {} });

    const state = freshState();
    const result = await runOcrPages(state, makeDeps());

    expect(result.paused).toBe(false);
    expect(state.pageOutputs).toHaveLength(2);
    expect(state.pageOutputs.map((p) => p.text)).toEqual(["page 1", "page 2"]);
    expect(state.checkpoints).toHaveLength(2);
    expect(state.partialPageResults).toHaveLength(2);
    expect(state.extractedTextSoFar).toContain("page 1");
    expect(state.extractedTextSoFar).toContain("page 2");
    expect(state.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(mockedDbUpdate).toHaveBeenCalledTimes(4);
  });

  it("pauses and returns early when stop is requested before a page starts", async () => {
    mockedIsStopRequested.mockResolvedValueOnce(true);
    const pause = vi.fn().mockResolvedValue(undefined);

    const state = freshState();
    const result = await runOcrPages(state, makeDeps({ pauseAtCheckpoint: pause }));

    expect(result.paused).toBe(true);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(mockedRunProvider).not.toHaveBeenCalled();
  });

  it("pauses on OcrStopRequestedError thrown mid-page and does not record the page", async () => {
    mockedRunProvider.mockRejectedValueOnce(new OcrStopRequestedError("stop"));
    const pause = vi.fn().mockResolvedValue(undefined);

    const state = freshState();
    const result = await runOcrPages(state, makeDeps({ pauseAtCheckpoint: pause }));

    expect(result.paused).toBe(true);
    expect(state.pageOutputs).toHaveLength(0);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-stop errors so the orchestrator can route to the failure path", async () => {
    mockedRunProvider.mockRejectedValueOnce(new Error("provider 500"));

    const state = freshState();
    await expect(runOcrPages(state, makeDeps())).rejects.toThrow("provider 500");
    expect(state.pageOutputs).toHaveLength(0);
  });

  it("uses pageNumbers for the result's pageNumber when provided (subset OCR)", async () => {
    mockedRunProvider
      .mockResolvedValueOnce({ text: "p3", structured: { markdown: "p3" }, metadata: {} })
      .mockResolvedValueOnce({ text: "p7", structured: { markdown: "p7" }, metadata: {} });

    const state = freshState();
    const result = await runOcrPages(state, makeDeps({ pageNumbers: [3, 7] }));

    expect(result.paused).toBe(false);
    expect(state.pageOutputs.map((p) => p.pageNumber)).toEqual([3, 7]);
    expect(state.pageOutputs.map((p) => p.text)).toEqual(["p3", "p7"]);
    expect(state.checkpoints.map((c) => c.pageNumber)).toEqual([3, 7]);
  });

  describe("text-layer fast-path + anchoring", () => {
    const richBodyLine = "This is a real sentence with normal English words used for testing.";
    const richAnchor = {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      blocks: [
        { text: "Section One", x: 50, y: 50, width: 200, height: 14, fontSize: 24 },
        { text: richBodyLine, x: 50, y: 80, width: 400, height: 12, fontSize: 12 },
        { text: richBodyLine, x: 50, y: 100, width: 400, height: 12, fontSize: 12 },
        { text: richBodyLine, x: 50, y: 120, width: 400, height: 12, fontSize: 12 },
        { text: richBodyLine, x: 50, y: 140, width: 400, height: 12, fontSize: 12 },
      ],
      rawText: ["Section One", richBodyLine, richBodyLine, richBodyLine, richBodyLine].join("\n"),
      characterCount: 11 + richBodyLine.length * 4 + 4,
    };

    const junkLine = "@#$%^&*()_+{}:<>?|/.,-=";
    const junkAnchor = {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      blocks: [
        { text: junkLine, x: 0, y: 0, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 14, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 28, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 42, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 56, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 70, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 84, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 98, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 112, width: 50, height: 12, fontSize: 12 },
        { text: junkLine, x: 0, y: 126, width: 50, height: 12, fontSize: 12 },
      ],
      rawText: Array(10).fill(junkLine).join("\n"),
      characterCount: junkLine.length * 10 + 9,
    };

    it("uses text-layer fast-path when preferTextLayer + rich anchor and SKIPS the VLM", async () => {
      const state = freshState();
      const result = await runOcrPages(state, makeDeps({
        inputPreviews: ["data:image/png;base64,p1"],
        pageAnchors: [richAnchor],
        preferTextLayer: true,
      }));
      expect(result.paused).toBe(false);
      expect(mockedRunProvider).not.toHaveBeenCalled();
      const meta = state.pageOutputs[0].metadata as { source?: string };
      expect(meta.source).toBe("text-layer");
      expect(state.extractedTextSoFar).toContain("Section One");
    });

    it("falls back to VLM when anchor is junk OCR (low alpha/word-shape ratios)", async () => {
      mockedRunProvider.mockResolvedValueOnce({
        text: "vlm result", structured: { markdown: "vlm result" }, metadata: {},
      });
      const state = freshState();
      await runOcrPages(state, makeDeps({
        inputPreviews: ["data:image/png;base64,p1"],
        pageAnchors: [junkAnchor],
        preferTextLayer: true,
      }));
      expect(mockedRunProvider).toHaveBeenCalledTimes(1);
      const promptArg = mockedRunProvider.mock.calls[0][3] as string;
      expect(promptArg).toBe("extract");
    });

    it("anchors the VLM prompt when preferTextLayer is OFF but anchor is rich", async () => {
      mockedRunProvider.mockResolvedValueOnce({
        text: "vlm result", structured: { markdown: "vlm result" }, metadata: {},
      });
      const state = freshState();
      await runOcrPages(state, makeDeps({
        inputPreviews: ["data:image/png;base64,p1"],
        pageAnchors: [richAnchor],
        preferTextLayer: false,
      }));
      const promptArg = mockedRunProvider.mock.calls[0][3] as string;
      expect(promptArg).toContain("DOCUMENT-ANCHORING CONTEXT");
      expect(promptArg).toContain("Section One");
    });

    it("skips anchoring when documentPresetExpectsJson is true (invoice/form)", async () => {
      mockedRunProvider.mockResolvedValueOnce({
        text: "vlm result", structured: { markdown: "vlm result" }, metadata: {},
      });
      const state = freshState();
      await runOcrPages(state, makeDeps({
        inputPreviews: ["data:image/png;base64,p1"],
        pageAnchors: [richAnchor],
        preferTextLayer: true,
        documentPresetExpectsJson: true,
      }));
      expect(mockedRunProvider).toHaveBeenCalledTimes(1);
      const promptArg = mockedRunProvider.mock.calls[0][3] as string;
      expect(promptArg).not.toContain("DOCUMENT-ANCHORING CONTEXT");
    });
  });

  it("falls back to index+1 when pageNumbers is omitted", async () => {
    mockedRunProvider
      .mockResolvedValueOnce({ text: "page 1", structured: { markdown: "page 1" }, metadata: {} })
      .mockResolvedValueOnce({ text: "page 2", structured: { markdown: "page 2" }, metadata: {} });

    const state = freshState();
    await runOcrPages(state, makeDeps());

    expect(state.pageOutputs.map((p) => p.pageNumber)).toEqual([1, 2]);
  });

  it("respects startIndex when resuming partway", async () => {
    mockedRunProvider.mockResolvedValueOnce({
      text: "page 2",
      structured: { markdown: "page 2" },
      metadata: {},
    });

    const state = freshState();
    state.pageOutputs.push({
      pageNumber: 1,
      text: "page 1 (preexisting)",
      structured: { markdown: "page 1" },
      metadata: {},
      durationMs: 0,
    });

    const result = await runOcrPages(state, makeDeps({ startIndex: 1 }));

    expect(result.paused).toBe(false);
    expect(mockedRunProvider).toHaveBeenCalledTimes(1);
    expect(state.pageOutputs).toHaveLength(2);
    expect(state.pageOutputs[1].text).toBe("page 2");
  });
});
