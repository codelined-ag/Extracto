import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn().mockResolvedValue({}),
  create: vi.fn(),
  withOcrJobSlot: vi.fn().mockImplementation((_priority: number, fn: () => Promise<void>) => fn()),
  processOcrJobInBackground: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db", () => ({
  db: { ocrJob: { findFirst: m.findFirst, update: m.update, create: m.create } },
}));

vi.mock("@/lib/ocr/job-control", () => ({
  withOcrJobSlot: m.withOcrJobSlot,
}));

vi.mock("@/lib/ocr/pipeline", () => ({
  processOcrJobInBackground: m.processOcrJobInBackground,
}));

vi.mock("@/lib/ocr/job-seed", () => ({
  seedPostProcessingMeta: vi.fn().mockReturnValue({ enabled: false }),
}));

import { ApiRouteError } from "@/lib/api-error";
import { resumeOcrJob } from "@/lib/ocr/job-submit";

const baseInput = {
  jobId: "job-1",
  userId: "u1",
  apiKeyId: null,
  fileName: "doc.pdf",
  model: "qwen",
  ocrModel: "qwen",
  provider: "ollama" as const,
  settings: { provider: "ollama" as const, apiEndpoint: "http://o", apiKey: "" },
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
 piiRedaction: false,
  },
  postProcessingPayload: {
    enabled: false,
    instruction: "",
    outputFormat: "markdown" as const,
    model: "",
    template: "custom" as const,
    targetLanguage: "",
  },
  inputPreviews: ["data:image/png;base64,a", "data:image/png;base64,b"],
  prompt: "PROMPT",
  sourcePreview: null,
};

beforeEach(() => {
  m.findFirst.mockReset();
  m.update.mockReset().mockResolvedValue({});
  m.withOcrJobSlot.mockReset().mockImplementation((_p: number, fn: () => Promise<void>) => fn());
  m.processOcrJobInBackground.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("resumeOcrJob", () => {
  it("throws 404 when no row matches the userId-scoped lookup", async () => {
    m.findFirst.mockResolvedValueOnce(null);
    await expect(resumeOcrJob(baseInput)).rejects.toMatchObject({
      message: "Resume job not found",
      status: 404,
    });
    expect(m.processOcrJobInBackground).not.toHaveBeenCalled();
  });

  it("throws 400 when the job is already COMPLETED", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "job-1", status: "COMPLETED", result: null, metadata: null, priority: 0 });
    await expect(resumeOcrJob(baseInput)).rejects.toMatchObject({
      message: "Job is already completed",
      status: 400,
    });
  });

  it("throws 409 when the job is already PROCESSING", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "job-1", status: "PROCESSING", result: null, metadata: null, priority: 0 });
    await expect(resumeOcrJob(baseInput)).rejects.toMatchObject({
      message: "Job is already processing",
      status: 409,
    });
  });

  it("throws 400 when every page is already checkpointed", async () => {
    const fullCheckpoints = baseInput.inputPreviews.map((_, idx) => ({
      pageNumber: idx + 1,
      text: `page ${idx + 1}`,
      structured: { markdown: `page ${idx + 1}` },
      durationMs: 10,
    }));
    m.findFirst.mockResolvedValueOnce({
      id: "job-1",
      status: "QUEUED",
      result: null,
      metadata: { pageRecords: fullCheckpoints },
      priority: 0,
    });
    await expect(resumeOcrJob(baseInput)).rejects.toBeInstanceOf(ApiRouteError);
    expect(m.processOcrJobInBackground).not.toHaveBeenCalled();
  });

  it("flips the row to PROCESSING and kicks off the orchestrator with the partial checkpoint", async () => {
    const oneCheckpoint = [
      {
        pageNumber: 1,
        text: "page 1",
        structured: { markdown: "page 1" },
        durationMs: 12,
      },
    ];
    m.findFirst.mockResolvedValueOnce({
      id: "job-1",
      status: "QUEUED",
      result: null,
      metadata: { pageRecords: oneCheckpoint },
      priority: 5,
    });
    const result = await resumeOcrJob(baseInput);
    expect(result).toEqual({ jobId: "job-1", pageCount: 2, pageRecords: 1 });
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "PROCESSING" }),
      }),
    );
    expect(m.processOcrJobInBackground).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        startIndex: 1,
        resumed: true,
        initialPageOutputs: expect.any(Array),
      }),
    );
  });
});
