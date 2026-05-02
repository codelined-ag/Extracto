import { describe, it, expect } from "vitest";
import {
  appendProgressEvent,
  buildProgressMetadata,
  createProgressSnapshotter,
  ocrStageProgressPct,
} from "@/lib/ocr/pipeline-progress";
import type { OcrProgressEvent } from "@/lib/ocr/pipeline-progress";

describe("appendProgressEvent", () => {
  it("appends a stamped event onto the existing list", () => {
    const out = appendProgressEvent([], "ocr", "page 1");
    expect(out).toHaveLength(1);
    expect(out[0].stage).toBe("ocr");
    expect(out[0].message).toBe("page 1");
    expect(typeof out[0].at).toBe("string");
  });

  it("preserves the input array (immutable)", () => {
    const input: OcrProgressEvent[] = [];
    appendProgressEvent(input, "queued", "x");
    expect(input).toHaveLength(0);
  });

  it("caps the trailing buffer at 60 events", () => {
    let acc: OcrProgressEvent[] = [];
    for (let i = 0; i < 100; i++) acc = appendProgressEvent(acc, "ocr", `page ${i}`);
    expect(acc).toHaveLength(60);
    expect(acc[0].message).toBe("page 40");
    expect(acc[59].message).toBe("page 99");
  });
});

describe("buildProgressMetadata", () => {
  const baseInput = {
    stage: "ocr" as const,
    message: "running",
    progressPct: 42,
    pageCount: 5,
    processedPages: 2,
    currentPage: 3,
    etaSeconds: 30,
    startedAt: "2026-01-01T00:00:00Z",
    events: [] as OcrProgressEvent[],
    checkpoints: [],
    postProcessing: { enabled: false },
  };

  it("clamps progressPct to [0, 100] and rounds", () => {
    expect(buildProgressMetadata({ ...baseInput, progressPct: 142 }).progressPct).toBe(100);
    expect(buildProgressMetadata({ ...baseInput, progressPct: -5 }).progressPct).toBe(0);
    expect(buildProgressMetadata({ ...baseInput, progressPct: 33.7 }).progressPct).toBe(34);
  });

  it("stamps updatedAt at every call", () => {
    const a = buildProgressMetadata(baseInput);
    expect(typeof a.updatedAt).toBe("string");
    expect(Date.parse(a.updatedAt)).not.toBeNaN();
  });

  it("threads non-progress fields through verbatim", () => {
    const m = buildProgressMetadata(baseInput);
    expect(m.stage).toBe("ocr");
    expect(m.pageCount).toBe(5);
    expect(m.currentPage).toBe(3);
    expect(m.etaSeconds).toBe(30);
  });
});

describe("ocrStageProgressPct", () => {
  it("scales to 100% when post-processing is disabled", () => {
    expect(ocrStageProgressPct(5, 10, false)).toBe(50);
    expect(ocrStageProgressPct(10, 10, false)).toBe(100);
  });

  it("caps the OCR phase at 85% when post-processing is enabled", () => {
    expect(ocrStageProgressPct(5, 10, true)).toBe(42.5);
    expect(ocrStageProgressPct(10, 10, true)).toBe(85);
  });

  it("returns 0 for empty page count instead of NaN", () => {
    expect(ocrStageProgressPct(0, 0, false)).toBe(0);
    expect(ocrStageProgressPct(3, 0, true)).toBe(0);
  });
});

describe("createProgressSnapshotter", () => {
  it("reads mutable state via getters at call time, not at construction", () => {
    let processed = 0;
    let events: OcrProgressEvent[] = [];
    const snapshot = createProgressSnapshotter({
      pageCount: 4,
      startedAt: "2026-01-01T00:00:00Z",
      getProcessedPages: () => processed,
      getEvents: () => events,
      getCheckpoints: () => [],
      getPostProcessing: () => ({ enabled: false }),
    });

    const a = snapshot({ stage: "analyzing", message: "warm", progressPct: 5 });
    processed = 2;
    events = [{ at: "2026-01-01T00:00:01Z", stage: "ocr", message: "page 1" }];
    const b = snapshot({ stage: "ocr", message: "running", progressPct: 50, currentPage: 2, etaSeconds: 12 });

    expect(a.processedPages).toBe(0);
    expect(a.events).toHaveLength(0);
    expect(b.processedPages).toBe(2);
    expect(b.events).toHaveLength(1);
    expect(b.currentPage).toBe(2);
    expect(b.etaSeconds).toBe(12);
    expect(b.pageCount).toBe(4);
    expect(b.startedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("defaults currentPage and etaSeconds to null when omitted", () => {
    const snapshot = createProgressSnapshotter({
      pageCount: 1,
      startedAt: "2026-01-01T00:00:00Z",
      getProcessedPages: () => 0,
      getEvents: () => [],
      getCheckpoints: () => [],
      getPostProcessing: () => ({ enabled: false }),
    });
    const out = snapshot({ stage: "queued", message: "x", progressPct: 0 });
    expect(out.currentPage).toBeNull();
    expect(out.etaSeconds).toBeNull();
  });
});
