import { db } from "@/lib/db";

const ocrRunningJobs = new Set<string>();
const ocrAbortControllers = new Map<string, Set<AbortController>>();

const stopRequestCache = new Map<string, { value: boolean; expiresAt: number }>();
const STOP_REQUEST_CACHE_TTL_MS = 1_000;

export function markOcrJobRunning(jobId: string): void {
  ocrRunningJobs.add(jobId);
  stopRequestCache.delete(jobId);
}

export function clearOcrJobRunning(jobId: string): void {
  ocrRunningJobs.delete(jobId);
  ocrAbortControllers.delete(jobId);
  stopRequestCache.delete(jobId);
}

export function isOcrJobRunning(jobId: string): boolean {
  return ocrRunningJobs.has(jobId);
}

export async function requestOcrJobStop(jobId: string): Promise<void> {
  await db.ocrJob.update({
    where: { id: jobId },
    data: { stopRequestedAt: new Date() },
  });
  stopRequestCache.set(jobId, { value: true, expiresAt: Date.now() + STOP_REQUEST_CACHE_TTL_MS });
}

export async function clearOcrJobStop(jobId: string): Promise<void> {
  await db.ocrJob.update({
    where: { id: jobId },
    data: { stopRequestedAt: null },
  });
  stopRequestCache.delete(jobId);
}

/**
 * Cached read of the stop-requested flag. The cache write on a miss is
 * intentional (high-frequency poll path); honest in-name predicates
 * would have been "loadOcrJobStopRequestedThroughCache" — kept as
 * `is*` because callers treat it as a boolean predicate, and the cache
 * lifetime is bounded by STOP_REQUEST_CACHE_TTL_MS.
 */
export async function isOcrJobStopRequested(jobId: string): Promise<boolean> {
  const cached = stopRequestCache.get(jobId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const row = await db.ocrJob.findUnique({
    where: { id: jobId },
    select: { stopRequestedAt: true },
  });
  const value = row?.stopRequestedAt != null;
  stopRequestCache.set(jobId, { value, expiresAt: now + STOP_REQUEST_CACHE_TTL_MS });
  return value;
}

export function registerOcrJobAbortController(
  jobId: string,
  controller: AbortController
): void {
  const existing = ocrAbortControllers.get(jobId);
  if (existing) {
    existing.add(controller);
    return;
  }
  ocrAbortControllers.set(jobId, new Set([controller]));
}

export function unregisterOcrJobAbortController(
  jobId: string,
  controller: AbortController
): void {
  const existing = ocrAbortControllers.get(jobId);
  if (!existing) {
    return;
  }

  existing.delete(controller);
  if (existing.size === 0) {
    ocrAbortControllers.delete(jobId);
  }
}

export function abortOcrJobRequests(jobId: string): void {
  const existing = ocrAbortControllers.get(jobId);
  if (!existing) {
    return;
  }

  for (const controller of existing) {
    controller.abort();
  }
  ocrAbortControllers.delete(jobId);
}

interface PriorityWaiter {
  priority: number;
  enqueueOrder: number;
  resolve: () => void;
}

function getConcurrencyLimit(): number {
  const raw = Number(process.env.OCR_WORKER_CONCURRENCY || "2");
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 16) : 2;
}

let activeJobs = 0;
let waiterCounter = 0;
const waiters: PriorityWaiter[] = [];

function pumpWaiters(): void {
  if (waiters.length === 0 || activeJobs >= getConcurrencyLimit()) return;
  waiters.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.enqueueOrder - b.enqueueOrder;
  });
  while (activeJobs < getConcurrencyLimit() && waiters.length > 0) {
    const next = waiters.shift();
    if (!next) return;
    activeJobs++;
    next.resolve();
  }
}

export async function withOcrJobSlot<T>(
  priority: number,
  task: () => Promise<T>
): Promise<T> {
  await new Promise<void>((resolve) => {
    if (activeJobs < getConcurrencyLimit()) {
      activeJobs++;
      resolve();
      return;
    }
    waiters.push({ priority, enqueueOrder: ++waiterCounter, resolve });
  });

  try {
    return await task();
  } finally {
    activeJobs--;
    pumpWaiters();
  }
}

export function getOcrQueueDepth(): { active: number; waiting: number } {
  return { active: activeJobs, waiting: waiters.length };
}
