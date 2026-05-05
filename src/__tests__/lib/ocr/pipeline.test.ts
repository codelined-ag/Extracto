import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted, so module-level mock targets must live in a vi.hoisted
// block to be accessible inside the factory closures.
const m = vi.hoisted(() => ({
  db: {
    ocrJob: {
      update: vi.fn(),
      create: vi.fn(),
    },
  },
  maybeUploadResultText: vi.fn(),
  maybeUploadResultJson: vi.fn(),
  dispatchJobWebhooks: vi.fn(),
  isOcrJobStopRequested: vi.fn(),
  markOcrJobRunning: vi.fn(),
  clearOcrJobRunning: vi.fn(),
  clearOcrJobStop: vi.fn(),
  registerOcrJobAbortController: vi.fn(),
  unregisterOcrJobAbortController: vi.fn(),
  withOcrJobSlot: vi.fn(),
  runOllamaOcr: vi.fn(),
  runOllamaPostProcessing: vi.fn(),
  unloadOllamaModel: vi.fn().mockResolvedValue(undefined),
  warmupOllamaModel: vi.fn().mockResolvedValue(undefined),
  runMistralOcr: vi.fn(),
  runMistralPostProcessing: vi.fn(),
  runCompatOcr: vi.fn(),
  runCompatPostProcessing: vi.fn(),
  discoverCompatModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/ocr/result-store", () => ({
  maybeUploadResultText: m.maybeUploadResultText,
  maybeUploadResultJson: m.maybeUploadResultJson,
}));
vi.mock("@/lib/background/webhooks", () => ({
  dispatchJobWebhooks: m.dispatchJobWebhooks,
}));
vi.mock("@/lib/ocr/job-control", () => ({
  isOcrJobStopRequested: m.isOcrJobStopRequested,
  markOcrJobRunning: m.markOcrJobRunning,
  clearOcrJobRunning: m.clearOcrJobRunning,
  clearOcrJobStop: m.clearOcrJobStop,
  registerOcrJobAbortController: m.registerOcrJobAbortController,
  unregisterOcrJobAbortController: m.unregisterOcrJobAbortController,
  withOcrJobSlot: m.withOcrJobSlot,
}));
vi.mock("@/lib/ocr/providers/ollama", () => ({
  runOllamaOcr: m.runOllamaOcr,
  runOllamaPostProcessing: m.runOllamaPostProcessing,
  unloadOllamaModel: m.unloadOllamaModel,
  warmupOllamaModel: m.warmupOllamaModel,
}));
vi.mock("@/lib/ocr/providers/mistral", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ocr/providers/mistral")>(
    "@/lib/ocr/providers/mistral",
  );
  return {
    ...actual,
    runMistralOcr: m.runMistralOcr,
    runMistralPostProcessing: m.runMistralPostProcessing,
  };
});
vi.mock("@/lib/ocr/providers/compat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ocr/providers/compat")>(
    "@/lib/ocr/providers/compat",
  );
  return {
    ...actual,
    runCompatOcr: m.runCompatOcr,
    runCompatPostProcessing: m.runCompatPostProcessing,
    discoverCompatModels: m.discoverCompatModels,
  };
});

import { buildPrompt, normalizePreviewForHistory, sanitizePostProcessing } from "@/lib/ocr/job-input-helpers";
import { parseCheckpointPages, submitOcrJob } from "@/lib/ocr/job-submit";
import { toJsonValue } from "@/lib/ocr/pipeline-result-builder";
import {
  buildPostProcessingPrompt,
  computeTextStats,
  formatPageScopedText,
  normalizePostProcessedText,
} from "@/lib/ocr/pipeline-post-processing";
import {
  appendProgressEvent,
  buildProgressMetadata,
  type OcrProgressEvent,
} from "@/lib/ocr/pipeline-progress";

const PREVIEW =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

beforeEach(() => {
  vi.clearAllMocks();
  m.isOcrJobStopRequested.mockResolvedValue(false);
  m.clearOcrJobStop.mockResolvedValue(undefined);
  m.markOcrJobRunning.mockReturnValue(undefined);
  m.clearOcrJobRunning.mockReturnValue(undefined);
  m.registerOcrJobAbortController.mockReturnValue(undefined);
  m.unregisterOcrJobAbortController.mockReturnValue(undefined);
  m.withOcrJobSlot.mockImplementation((_priority: number, fn: () => Promise<void>) => fn());
  m.maybeUploadResultText.mockResolvedValue({ inline: "extracted text", location: null });
  m.maybeUploadResultJson.mockResolvedValue({ inline: { ok: true }, location: null });
  m.dispatchJobWebhooks.mockResolvedValue(undefined);
  m.db.ocrJob.update.mockResolvedValue({});
  m.db.ocrJob.create.mockResolvedValue({ id: "job-test-1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("sanitizePostProcessing", () => {
  it("disables when instruction is empty even if enabled=true", () => {
    expect(sanitizePostProcessing({ enabled: true, instruction: "" })).toMatchObject({
      enabled: false,
    });
  });

  it("enables when instruction is non-empty AND enabled=true", () => {
    expect(sanitizePostProcessing({ enabled: true, instruction: "summarize" })).toMatchObject({
      enabled: true,
      instruction: "summarize",
      outputFormat: "markdown",
    });
  });

  it("defaults outputFormat to markdown when unset", () => {
    expect(sanitizePostProcessing({ enabled: true, instruction: "x" }).outputFormat).toBe("markdown");
  });

  it("preserves outputFormat='json' when set explicitly", () => {
    expect(sanitizePostProcessing({ enabled: true, instruction: "x", outputFormat: "json" }).outputFormat).toBe("json");
  });

  it("trims instruction whitespace", () => {
    expect(sanitizePostProcessing({ enabled: true, instruction: "  trim me  " }).instruction).toBe("trim me");
  });

  it("clamps instruction to max length (6000 chars)", () => {
    const long = "x".repeat(7000);
    expect(sanitizePostProcessing({ enabled: true, instruction: long }).instruction.length).toBe(6000);
  });

  it("trims model field", () => {
    expect(sanitizePostProcessing({ enabled: true, instruction: "x", model: "  gpt  " }).model).toBe("gpt");
  });

  it("returns empty model when unset", () => {
    expect(sanitizePostProcessing({ enabled: true, instruction: "x" }).model).toBe("");
  });
});

describe("normalizePreviewForHistory", () => {
  it("returns trimmed data URL when input is a valid data:image preview", () => {
    expect(normalizePreviewForHistory("  " + PREVIEW + "  ")).toBe(PREVIEW);
  });

  it("returns null for non-data: URLs", () => {
    expect(normalizePreviewForHistory("https://example.com/img.png")).toBeNull();
  });

  it("returns null for non-image data: URLs", () => {
    expect(normalizePreviewForHistory("data:text/plain;base64,SGVsbG8=")).toBeNull();
  });

  it("returns null for previews exceeding the max length (1.5MB)", () => {
    const huge = "data:image/png;base64," + "A".repeat(1_500_001);
    expect(normalizePreviewForHistory(huge)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(normalizePreviewForHistory("")).toBeNull();
  });
});

describe("buildPrompt", () => {
  const baseSettings = {
    language: "auto",
    tableDetection: true,
    handwritingRecognition: false,
    preserveFormatting: true,
    customPrompt: "",
    quality: 80, preferTextLayer: true, documentPreset: "generic" as const, pageConcurrency: 1, autoRetryMaxAttempts: 1 };

  it("includes the language instruction when language is not 'auto'", () => {
    const prompt = buildPrompt({ ...baseSettings, language: "fr" });
    expect(prompt).toContain("The document is in fr");
  });

  it("includes the auto-detect instruction when language is 'auto'", () => {
    const prompt = buildPrompt(baseSettings);
    expect(prompt).toContain("Detect the document language automatically");
  });

  it("includes the customPrompt when provided", () => {
    const prompt = buildPrompt({ ...baseSettings, customPrompt: "Look for invoice numbers" });
    expect(prompt).toContain("Look for invoice numbers");
  });

  it("requests JSON output shape with markdown + fields", () => {
    const prompt = buildPrompt(baseSettings);
    expect(prompt).toContain('"markdown"');
    expect(prompt).toContain('"fields"');
  });
});

describe("buildPostProcessingPrompt", () => {
  it("yields a system + user prompt with the user instruction inlined", () => {
    const result = buildPostProcessingPrompt({
      enabled: true,
      instruction: "extract invoice fields",
      outputFormat: "markdown",
      model: "",
      template: "custom",
      targetLanguage: "",
    });
    expect(result.systemPrompt).toContain("post-processing assistant");
    expect(result.userPrompt).toContain("extract invoice fields");
  });

  it("requests JSON output when outputFormat is 'json'", () => {
    const result = buildPostProcessingPrompt({
      enabled: true,
      instruction: "extract",
      outputFormat: "json",
      model: "",
      template: "custom",
      targetLanguage: "",
    });
    expect(result.userPrompt).toContain("Return only valid JSON");
  });

  it("requests markdown output when outputFormat is 'markdown'", () => {
    const result = buildPostProcessingPrompt({
      enabled: true,
      instruction: "polish",
      outputFormat: "markdown",
      model: "",
      template: "custom",
      targetLanguage: "",
    });
    expect(result.userPrompt).toContain("Return markdown only");
  });
});

describe("normalizePostProcessedText", () => {
  it("returns text trimmed for markdown format (no JSON parsing)", () => {
    expect(normalizePostProcessedText("  hello  ", "markdown")).toEqual({ text: "hello" });
  });

  it("parses + reformats JSON when outputFormat is 'json'", () => {
    const result = normalizePostProcessedText('{"a":1,"b":2}', "json");
    expect(result.parsedJson).toEqual({ a: 1, b: 2 });
    expect(result.text).toContain('"a": 1');
  });

  it("strips ```json fences before parsing", () => {
    const result = normalizePostProcessedText('```json\n{"a":1}\n```', "json");
    expect(result.parsedJson).toEqual({ a: 1 });
  });

  it("strips bare ``` fences too", () => {
    const result = normalizePostProcessedText('```\n{"a":1}\n```', "json");
    expect(result.parsedJson).toEqual({ a: 1 });
  });

  it("returns text trimmed when JSON parse fails", () => {
    const result = normalizePostProcessedText("  not json  ", "json");
    expect(result.text).toBe("not json");
    expect(result.parsedJson).toBeUndefined();
  });
});

describe("computeTextStats", () => {
  it("counts characters, words, and lines correctly", () => {
    expect(computeTextStats("hello world\nfoo bar\nbaz")).toEqual({
      characterCount: 23,
      wordCount: 5,
      lineCount: 3,
    });
  });

  it("returns zeros for empty/whitespace input", () => {
    expect(computeTextStats("   ")).toEqual({ characterCount: 0, wordCount: 0, lineCount: 0 });
  });

  it("collapses multiple whitespace into a single word boundary", () => {
    expect(computeTextStats("foo   bar").wordCount).toBe(2);
  });
});

describe("formatPageScopedText", () => {
  it("wraps each page with [PAGE n] / [END PAGE n] markers", () => {
    const out = formatPageScopedText([
      { pageNumber: 1, text: "first" },
      { pageNumber: 2, text: "second" },
    ]);
    expect(out).toContain("[PAGE 1]");
    expect(out).toContain("first");
    expect(out).toContain("[END PAGE 1]");
    expect(out).toContain("[PAGE 2]");
    expect(out).toContain("second");
  });

  it("trims per-page text inside markers", () => {
    const out = formatPageScopedText([{ pageNumber: 1, text: "  trim  " }]);
    expect(out).toContain("trim");
    expect(out).not.toContain("  trim  ");
  });

  it("joins pages with double newlines between markers", () => {
    const out = formatPageScopedText([
      { pageNumber: 1, text: "a" },
      { pageNumber: 2, text: "b" },
    ]);
    expect(out.split("\n\n").length).toBe(2);
  });
});

describe("appendProgressEvent", () => {
  it("appends event with current ISO timestamp", () => {
    const before = appendProgressEvent([], "queued", "first");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ stage: "queued", message: "first" });
    expect(typeof before[0].at).toBe("string");
  });

  it("preserves earlier events when appending", () => {
    const events = appendProgressEvent([{ at: "x", stage: "queued", message: "old" }], "ocr", "new");
    expect(events).toHaveLength(2);
    expect(events[0].message).toBe("old");
    expect(events[1].message).toBe("new");
  });

  it("trims to the most recent 60 events when over the cap", () => {
    let events: OcrProgressEvent[] = Array.from({ length: 70 }, (_, i) => ({
      at: `t${i}`,
      stage: "queued" as const,
      message: `m${i}`,
    }));
    events = appendProgressEvent(events, "ocr", "newest");
    expect(events).toHaveLength(60);
    expect(events[events.length - 1].message).toBe("newest");
  });
});

describe("buildProgressMetadata", () => {
  const base = {
    stage: "ocr" as const,
    message: "in progress",
    progressPct: 50,
    pageCount: 4,
    processedPages: 2,
    currentPage: 2,
    etaSeconds: 30,
    startedAt: "2026-05-02T00:00:00Z",
    events: [],
    checkpoints: [],
    postProcessing: { enabled: false },
  };

  it("clamps progressPct between 0 and 100", () => {
    expect(buildProgressMetadata({ ...base, progressPct: 150 }).progressPct).toBe(100);
    expect(buildProgressMetadata({ ...base, progressPct: -10 }).progressPct).toBe(0);
  });

  it("rounds progressPct to integer", () => {
    expect(buildProgressMetadata({ ...base, progressPct: 33.7 }).progressPct).toBe(34);
  });

  it("sets updatedAt to a fresh ISO timestamp", () => {
    const meta = buildProgressMetadata(base);
    expect(meta.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("preserves passed-through fields verbatim", () => {
    const meta = buildProgressMetadata(base);
    expect(meta.stage).toBe("ocr");
    expect(meta.pageCount).toBe(4);
    expect(meta.processedPages).toBe(2);
    expect(meta.currentPage).toBe(2);
  });
});

describe("toJsonValue", () => {
  it("strips undefined fields", () => {
    expect(toJsonValue({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });

  it("preserves nested objects and arrays", () => {
    expect(toJsonValue({ a: [1, 2, 3], b: { c: { d: "deep" } } })).toEqual({
      a: [1, 2, 3],
      b: { c: { d: "deep" } },
    });
  });

  it("handles null verbatim", () => {
    expect(toJsonValue({ x: null })).toEqual({ x: null });
  });
});

describe("parseCheckpointPages", () => {
  it("returns [] when result has no metadata.pageRecords", () => {
    expect(parseCheckpointPages({}, undefined)).toEqual([]);
  });

  it("normalizes a valid pageRecords array from metadata", () => {
    const pages = parseCheckpointPages(
      {},
      { pageRecords: [{ pageNumber: 1, text: "hello", durationMs: 100 }] },
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].pageNumber).toBe(1);
    expect(pages[0].text).toBe("hello");
    expect(pages[0].structured).toEqual({ markdown: "hello" });
  });

  it("falls back to result.metadata.pageRecords when metadata arg is empty", () => {
    const pages = parseCheckpointPages(
      { metadata: { pageRecords: [{ pageNumber: 1, text: "x" }] } },
      {},
    );
    expect(pages).toHaveLength(1);
  });

  it("filters out entries missing required fields", () => {
    const pages = parseCheckpointPages(
      {},
      { pageRecords: [{ pageNumber: 1, text: "ok" }, { text: "no number" }, { pageNumber: 3 }] },
    );
    expect(pages).toHaveLength(1);
    expect(pages[0].pageNumber).toBe(1);
  });

  it("sorts pages by pageNumber", () => {
    const pages = parseCheckpointPages(
      {},
      {
        pageRecords: [
          { pageNumber: 3, text: "third" },
          { pageNumber: 1, text: "first" },
          { pageNumber: 2, text: "second" },
        ],
      },
    );
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
  });
});

describe("submitOcrJob", () => {
  const baseInput = {
    userId: "user-1",
    apiKeyId: null,
    fileName: "test.pdf",
    model: "llava:7b",
    ocrModel: "llava:7b",
    provider: "ollama" as const,
    settings: { provider: "ollama" as const, apiEndpoint: "http://h:11434", apiKey: "" },
    settingsPayload: {
      language: "auto",
      tableDetection: true,
      handwritingRecognition: false,
      preserveFormatting: true,
      customPrompt: "",
      quality: 80,
      preferTextLayer: true,
      documentPreset: "generic" as const,
      pageConcurrency: 1,
      autoRetryMaxAttempts: 1,
    },
    postProcessingPayload: { enabled: false, instruction: "", outputFormat: "markdown" as const, model: "", template: "custom" as const, targetLanguage: "" },
    inputPreviews: [PREVIEW],
    prompt: "extract text",
    sourcePreview: PREVIEW,
  };

  beforeEach(() => {
    // For submitOcrJob tests we want submitOcrJob to NOT actually run the
    // background job (just persist + queue). Stub processOcrJobInBackground
    // by mocking the runner that the orchestrator calls first.
    m.runOllamaOcr.mockResolvedValue({
      text: "extracted text",
      structured: { markdown: "extracted text" },
      metadata: {},
    });
  });

  it("creates the OcrJob row with PROCESSING status", async () => {
    await submitOcrJob(baseInput);
    expect(m.db.ocrJob.create).toHaveBeenCalledTimes(1);
    const args = m.db.ocrJob.create.mock.calls[0][0];
    expect(args.data.status).toBe("PROCESSING");
    expect(args.data.userId).toBe("user-1");
    expect(args.data.fileName).toBe("test.pdf");
    expect(args.data.model).toBe("llava:7b");
  });

  it("returns the created jobId and the page count", async () => {
    const result = await submitOcrJob(baseInput);
    expect(result).toEqual({ jobId: "job-test-1", pageCount: 1 });
  });

  it("kicks off the background pipeline via withOcrJobSlot at the requested priority", async () => {
    await submitOcrJob({ ...baseInput, priority: 5 });
    expect(m.withOcrJobSlot).toHaveBeenCalledTimes(1);
    expect(m.withOcrJobSlot.mock.calls[0][0]).toBe(5);
  });

  it("defaults priority to 0 when not provided", async () => {
    await submitOcrJob(baseInput);
    expect(m.withOcrJobSlot.mock.calls[0][0]).toBe(0);
  });

  it("propagates batchId into the OcrJob row", async () => {
    await submitOcrJob({ ...baseInput, batchId: "batch_abc" });
    expect(m.db.ocrJob.create.mock.calls[0][0].data.batchId).toBe("batch_abc");
  });

  it("snapshots settingsPayload + postProcessingPayload into settingsSnapshot", async () => {
    await submitOcrJob(baseInput);
    const snap = m.db.ocrJob.create.mock.calls[0][0].data.settingsSnapshot;
    expect(snap.settings).toMatchObject({ language: "auto", quality: 80 });
    expect(snap.postProcessing.enabled).toBe(false);
  });

  it("seeds initial metadata.stage to 'queued' with progressPct=0", async () => {
    await submitOcrJob(baseInput);
    const meta = m.db.ocrJob.create.mock.calls[0][0].data.metadata;
    expect(meta.stage).toBe("queued");
    expect(meta.progressPct).toBe(0);
    expect(meta.events[0].stage).toBe("queued");
    expect(meta.events[0].message).toBe("Job created");
  });

  it("adds a Mistral-specific event when ocrModel differs from inference model", async () => {
    await submitOcrJob({
      ...baseInput,
      provider: "mistral",
      model: "mistral-large-latest",
      ocrModel: "mistral-ocr-latest",
    });
    const meta = m.db.ocrJob.create.mock.calls[0][0].data.metadata;
    expect(meta.events.some((e: { message: string }) =>
      e.message.includes("mistral-ocr-latest") && e.message.includes("mistral-large-latest"),
    )).toBe(true);
  });
});
