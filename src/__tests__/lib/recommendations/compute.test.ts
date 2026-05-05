import { describe, expect, it } from "vitest";

import { computeRecommendations, type JobSample } from "@/lib/recommendations/compute";

function sample(over: Partial<JobSample> = {}): JobSample {
  return {
    documentType: "invoice",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    status: "COMPLETED",
    processingMs: 4000,
    ...over,
  };
}

describe("computeRecommendations", () => {
  it("groups samples by documentType", () => {
    const result = computeRecommendations([
      sample({ documentType: "invoice" }),
      sample({ documentType: "invoice" }),
      sample({ documentType: "invoice" }),
      sample({ documentType: "receipt" }),
      sample({ documentType: "receipt" }),
      sample({ documentType: "receipt" }),
    ]);
    expect(result.map((r) => r.documentType)).toEqual(["invoice", "receipt"]);
  });

  it("ranks the model with the highest success rate first", () => {
    const result = computeRecommendations([
      sample({ provider: "mistral", model: "mistral-ocr-latest", status: "COMPLETED" }),
      sample({ provider: "mistral", model: "mistral-ocr-latest", status: "COMPLETED" }),
      sample({ provider: "mistral", model: "mistral-ocr-latest", status: "COMPLETED" }),
      sample({ provider: "openrouter", model: "openai/gpt-4o", status: "FAILED" }),
      sample({ provider: "openrouter", model: "openai/gpt-4o", status: "FAILED" }),
      sample({ provider: "openrouter", model: "openai/gpt-4o", status: "COMPLETED" }),
    ]);
    expect(result[0].best?.model).toBe("mistral-ocr-latest");
    expect(result[0].best?.successRate).toBe(1);
  });

  it("flags insufficientData when all models are below the sample threshold", () => {
    const result = computeRecommendations([
      sample({ documentType: "form", model: "x" }),
      sample({ documentType: "form", model: "y" }),
    ]);
    expect(result[0].insufficientData).toBe(true);
  });

  it("breaks ties by attempts then meanMs", () => {
    const result = computeRecommendations([
      sample({ provider: "p1", model: "fast", processingMs: 1000 }),
      sample({ provider: "p1", model: "fast", processingMs: 1000 }),
      sample({ provider: "p1", model: "fast", processingMs: 1000 }),
      sample({ provider: "p2", model: "slow", processingMs: 5000 }),
      sample({ provider: "p2", model: "slow", processingMs: 5000 }),
      sample({ provider: "p2", model: "slow", processingMs: 5000 }),
    ]);
    expect(result[0].best?.model).toBe("fast");
  });

  it("computes meanMs only over completed jobs with processingMs", () => {
    const result = computeRecommendations([
      sample({ provider: "p", model: "m", status: "COMPLETED", processingMs: 1000 }),
      sample({ provider: "p", model: "m", status: "COMPLETED", processingMs: 3000 }),
      sample({ provider: "p", model: "m", status: "COMPLETED", processingMs: 5000 }),
    ]);
    expect(result[0].best?.meanMs).toBe(3000);
  });

  it("excludes FAILED jobs from meanMs even when they recorded processingMs", () => {
    const result = computeRecommendations([
      sample({ provider: "p", model: "m", status: "COMPLETED", processingMs: 1000 }),
      sample({ provider: "p", model: "m", status: "COMPLETED", processingMs: 1000 }),
      sample({ provider: "p", model: "m", status: "COMPLETED", processingMs: 1000 }),
      sample({ provider: "p", model: "m", status: "FAILED", processingMs: 999999 }),
    ]);
    expect(result[0].best?.meanMs).toBe(1000);
  });

  it("returns an empty array when there are no samples", () => {
    expect(computeRecommendations([])).toEqual([]);
  });

  it("limits alternatives to 3 entries", () => {
    const samples: JobSample[] = [];
    for (const m of ["a", "b", "c", "d", "e", "f"]) {
      samples.push(sample({ provider: "p", model: m, status: "COMPLETED" }));
      samples.push(sample({ provider: "p", model: m, status: "COMPLETED" }));
      samples.push(sample({ provider: "p", model: m, status: "COMPLETED" }));
    }
    const result = computeRecommendations(samples);
    expect(result[0].alternatives.length).toBeLessThanOrEqual(3);
  });
});
