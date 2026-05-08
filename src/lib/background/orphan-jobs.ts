import { OcrJobStatus } from "@prisma/client";

import { db } from "@/lib/db";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function staleAfterMs(): number {
  const raw = Number(process.env.OCR_ORPHAN_JOB_STALE_MS ?? "");
  if (Number.isFinite(raw) && raw >= 60_000) return raw;
  return 30 * 60 * 1000;
}

export async function sweepOrphanProcessingJobs(now: Date = new Date()): Promise<{ failed: number }> {
  const cutoff = new Date(now.getTime() - staleAfterMs());
  const result = await db.ocrJob.updateMany({
    where: {
      status: OcrJobStatus.PROCESSING,
      updatedAt: { lt: cutoff },
    },
    data: {
      status: OcrJobStatus.FAILED,
      errorMessage: "Process exited while OCR was running. Resubmit to retry.",
      completedAt: now,
    },
  });
  if (result.count > 0) {
    console.warn(`[orphan-jobs] swept ${result.count} stale PROCESSING row(s)`);
  }
  return { failed: result.count };
}

let started = false;

export function startOrphanJobSweep(): void {
  if (started) return;
  started = true;
  void sweepOrphanProcessingJobs().catch((err) => console.error("[orphan-jobs] initial sweep failed", err));
  setInterval(() => {
    void sweepOrphanProcessingJobs().catch((err) => console.error("[orphan-jobs] sweep failed", err));
  }, SWEEP_INTERVAL_MS).unref?.();
}
