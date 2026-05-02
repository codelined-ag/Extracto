import { db } from "@/lib/db";
import { deleteResultArtifacts } from "@/lib/ocr/result-store";

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SWEEP_PAGE_SIZE = 500;

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
    let totalDeleted = 0;

    for (;;) {
      const page = await db.ocrJob.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, extractedTextLocation: true, resultLocation: true },
        take: SWEEP_PAGE_SIZE,
        orderBy: { createdAt: "asc" },
      });
      if (page.length === 0) break;

      const ids = page.map((row) => row.id);
      const locations: Array<string | null | undefined> = [];
      for (const row of page) {
        locations.push(row.extractedTextLocation, row.resultLocation);
      }

      if (locations.length > 0) {
        await deleteResultArtifacts(locations);
      }

      const result = await db.ocrJob.deleteMany({ where: { id: { in: ids } } });
      totalDeleted += result.count;

      if (page.length < SWEEP_PAGE_SIZE) break;
    }

    if (totalDeleted > 0) {
      console.log(`[retention] deleted ${totalDeleted} job(s) older than ${days}d`);
    }
    return { deleted: totalDeleted, cutoff };
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
