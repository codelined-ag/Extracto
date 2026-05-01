import { db } from "@/lib/db";
import { deleteResultArtifacts } from "@/lib/result-store";

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getRetentionDays(): number {
  const raw = Number(process.env.RETAIN_JOBS_DAYS || "0");
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 3650);
}

let sweepRunning = false;

export async function sweepOldJobs(): Promise<{ deleted: number; cutoff: Date | null }> {
  const days = getRetentionDays();
  if (days === 0) {
    return { deleted: 0, cutoff: null };
  }
  if (sweepRunning) {
    return { deleted: 0, cutoff: null };
  }
  sweepRunning = true;
  try {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const offloaded = await db.ocrJob.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { extractedTextLocation: true, resultLocation: true },
      take: 1000,
    });
    const locations: Array<string | null | undefined> = [];
    for (const job of offloaded) {
      locations.push(job.extractedTextLocation, job.resultLocation);
    }
    if (locations.length > 0) {
      await deleteResultArtifacts(locations);
    }
    const result = await db.ocrJob.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      console.log(`[retention] deleted ${result.count} job(s) older than ${days}d`);
    }
    return { deleted: result.count, cutoff };
  } finally {
    sweepRunning = false;
  }
}

let started = false;

export function startJobRetentionSweep(): void {
  if (started) return;
  started = true;
  void sweepOldJobs().catch((error) => {
    console.error("[retention] initial sweep failed", error);
  });
  setInterval(() => {
    void sweepOldJobs().catch((error) => {
      console.error("[retention] sweep failed", error);
    });
  }, SWEEP_INTERVAL_MS).unref?.();
}
