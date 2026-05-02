import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    ocrJob: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import { db } from "@/lib/db";
import {
  markOcrJobRunning,
  clearOcrJobRunning,
  isOcrJobRunning,
  registerOcrJobAbortController,
  unregisterOcrJobAbortController,
  abortOcrJobRequests,
  getOcrQueueDepth,
  withOcrJobSlot,
  requestOcrJobStop,
  isOcrJobStopRequested,
} from "@/lib/ocr/job-control";

const mockDb = db as { ocrJob: { update: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.ocrJob.update.mockResolvedValue({});
  mockDb.ocrJob.findUnique.mockResolvedValue(null);
});

describe("running job tracking", () => {
  it("marks a job as running and detects it", () => {
    const id = "job-running-1";
    markOcrJobRunning(id);
    expect(isOcrJobRunning(id)).toBe(true);
    clearOcrJobRunning(id);
  });

  it("returns false for an unknown job", () => {
    expect(isOcrJobRunning("nonexistent-job-xyz")).toBe(false);
  });

  it("clearOcrJobRunning removes the job", () => {
    const id = "job-clear-1";
    markOcrJobRunning(id);
    clearOcrJobRunning(id);
    expect(isOcrJobRunning(id)).toBe(false);
  });

  it("handles multiple distinct jobs independently", () => {
    markOcrJobRunning("job-a");
    markOcrJobRunning("job-b");
    expect(isOcrJobRunning("job-a")).toBe(true);
    expect(isOcrJobRunning("job-b")).toBe(true);
    clearOcrJobRunning("job-a");
    expect(isOcrJobRunning("job-a")).toBe(false);
    expect(isOcrJobRunning("job-b")).toBe(true);
    clearOcrJobRunning("job-b");
  });
});

describe("abort controller management", () => {
  it("registers a controller and aborts it", () => {
    const id = "job-abort-1";
    const ctrl = new AbortController();
    registerOcrJobAbortController(id, ctrl);
    abortOcrJobRequests(id);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("aborts multiple controllers for the same job", () => {
    const id = "job-abort-multi";
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    registerOcrJobAbortController(id, ctrl1);
    registerOcrJobAbortController(id, ctrl2);
    abortOcrJobRequests(id);
    expect(ctrl1.signal.aborted).toBe(true);
    expect(ctrl2.signal.aborted).toBe(true);
  });

  it("no-ops abortOcrJobRequests when no controllers registered", () => {
    expect(() => abortOcrJobRequests("no-controllers")).not.toThrow();
  });

  it("unregisterOcrJobAbortController removes a specific controller", () => {
    const id = "job-unreg";
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    registerOcrJobAbortController(id, ctrl1);
    registerOcrJobAbortController(id, ctrl2);
    unregisterOcrJobAbortController(id, ctrl1);
    abortOcrJobRequests(id);
    expect(ctrl1.signal.aborted).toBe(false);
    expect(ctrl2.signal.aborted).toBe(true);
  });

  it("no-ops unregister for unknown jobId", () => {
    const ctrl = new AbortController();
    expect(() => unregisterOcrJobAbortController("no-job", ctrl)).not.toThrow();
  });

  it("clears abort controllers when clearOcrJobRunning is called", () => {
    const id = "job-clear-ctrl";
    const ctrl = new AbortController();
    markOcrJobRunning(id);
    registerOcrJobAbortController(id, ctrl);
    clearOcrJobRunning(id);
    abortOcrJobRequests(id);
    expect(ctrl.signal.aborted).toBe(false);
  });
});

describe("withOcrJobSlot", () => {
  it("executes a task and returns its result", async () => {
    const result = await withOcrJobSlot(0, async () => 42);
    expect(result).toBe(42);
  });

  it("propagates task errors", async () => {
    await expect(
      withOcrJobSlot(0, async () => { throw new Error("task failed"); })
    ).rejects.toThrow("task failed");
  });

  it("reports active job count while running", async () => {
    let depthDuringTask = { active: -1, waiting: -1 };
    await withOcrJobSlot(5, async () => {
      depthDuringTask = getOcrQueueDepth();
    });
    expect(depthDuringTask.active).toBeGreaterThanOrEqual(1);
  });

  it("restores depth to previous level after completion", async () => {
    const before = getOcrQueueDepth();
    await withOcrJobSlot(0, async () => "done");
    const after = getOcrQueueDepth();
    expect(after.active).toBe(before.active);
  });
});

describe("stop request cache", () => {
  it("requestOcrJobStop updates DB and caches the result", async () => {
    const id = "job-stop-1";
    await requestOcrJobStop(id);
    expect(mockDb.ocrJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id } })
    );
    // Cache hit — DB should not be called again immediately
    const stopped = await isOcrJobStopRequested(id);
    expect(stopped).toBe(true);
    expect(mockDb.ocrJob.findUnique).not.toHaveBeenCalled();
    clearOcrJobRunning(id);
  });

  it("isOcrJobStopRequested returns false when DB row has no stopRequestedAt", async () => {
    const id = "job-not-stopped";
    mockDb.ocrJob.findUnique.mockResolvedValue({ stopRequestedAt: null });
    const result = await isOcrJobStopRequested(id);
    expect(result).toBe(false);
  });

  it("isOcrJobStopRequested returns true when DB row has stopRequestedAt set", async () => {
    const id = "job-db-stopped";
    mockDb.ocrJob.findUnique.mockResolvedValue({ stopRequestedAt: new Date() });
    const result = await isOcrJobStopRequested(id);
    expect(result).toBe(true);
    clearOcrJobRunning(id);
  });
});
