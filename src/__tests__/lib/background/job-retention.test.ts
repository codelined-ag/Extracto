import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    ocrJob: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ocr/result-store", () => ({
  deleteResultArtifacts: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { deleteResultArtifacts } from "@/lib/ocr/result-store";
import { sweepOldJobs } from "@/lib/background/job-retention";

const mFindMany = db.ocrJob.findMany as ReturnType<typeof vi.fn>;
const mDeleteMany = db.ocrJob.deleteMany as ReturnType<typeof vi.fn>;
const mDeleteArtifacts = deleteResultArtifacts as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mFindMany.mockReset();
  mDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mDeleteArtifacts.mockReset().mockResolvedValue(undefined);
  delete process.env.RETAIN_JOBS_DAYS;
});
afterEach(() => vi.clearAllMocks());

describe("sweepOldJobs", () => {
  it("is a no-op when RETAIN_JOBS_DAYS is unset", async () => {
    const result = await sweepOldJobs();
    expect(result).toEqual({ deleted: 0, cutoff: null });
    expect(mFindMany).not.toHaveBeenCalled();
    expect(mDeleteMany).not.toHaveBeenCalled();
  });

  it("is a no-op when RETAIN_JOBS_DAYS is non-numeric or non-positive", async () => {
    for (const value of ["0", "-7", "abc", ""]) {
      process.env.RETAIN_JOBS_DAYS = value;
      const result = await sweepOldJobs();
      expect(result.deleted).toBe(0);
      expect(result.cutoff).toBeNull();
    }
    expect(mFindMany).not.toHaveBeenCalled();
  });

  it("clamps RETAIN_JOBS_DAYS to a 10-year ceiling", async () => {
    process.env.RETAIN_JOBS_DAYS = "99999";
    mFindMany.mockResolvedValueOnce([]);
    const result = await sweepOldJobs();
    expect(result.cutoff).not.toBeNull();
    const ageDays = (Date.now() - (result.cutoff as Date).getTime()) / 86_400_000;
    expect(ageDays).toBeGreaterThan(3649);
    expect(ageDays).toBeLessThan(3651);
  });

  it("deletes a single page of jobs and short-circuits when fewer than the page size", async () => {
    process.env.RETAIN_JOBS_DAYS = "30";
    mFindMany.mockResolvedValueOnce([
      { id: "j1", extractedTextLocation: "s3://x/j1.txt", resultLocation: null },
      { id: "j2", extractedTextLocation: null, resultLocation: "s3://x/j2.json" },
    ]);
    mDeleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await sweepOldJobs();

    expect(mFindMany).toHaveBeenCalledTimes(1);
    expect(mDeleteArtifacts).toHaveBeenCalledWith([
      "s3://x/j1.txt",
      null,
      null,
      "s3://x/j2.json",
    ]);
    expect(mDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ["j1", "j2"] } } });
    expect(result.deleted).toBe(2);
    expect(result.cutoff).toBeInstanceOf(Date);
  });

  it("paginates through full pages until a partial page is returned", async () => {
    process.env.RETAIN_JOBS_DAYS = "1";
    const fullPage = Array.from({ length: 500 }, (_, i) => ({
      id: `j${i}`,
      extractedTextLocation: null,
      resultLocation: null,
    }));
    mFindMany
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([{ id: "tail", extractedTextLocation: null, resultLocation: null }]);
    mDeleteMany.mockResolvedValue({ count: 500 });

    const result = await sweepOldJobs();
    expect(mFindMany).toHaveBeenCalledTimes(2);
    expect(result.deleted).toBe(1000);
  });

  it("guards against re-entrance while a sweep is in flight", async () => {
    process.env.RETAIN_JOBS_DAYS = "30";
    let resolvePage: (value: unknown[]) => void = () => {};
    mFindMany.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolvePage = resolve as typeof resolvePage;
      }),
    );

    const first = sweepOldJobs();
    const second = await sweepOldJobs();
    expect(second).toEqual({ deleted: 0, cutoff: null });

    resolvePage([]);
    await first;
  });
});
