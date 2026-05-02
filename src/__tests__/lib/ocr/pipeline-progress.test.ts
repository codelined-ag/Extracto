import { describe, it, expect } from "vitest";
import { appendProgressEvent, buildProgressMetadata } from "@/lib/ocr/pipeline-progress";
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
