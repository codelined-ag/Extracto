import { randomUUID } from "node:crypto";

export type KbExportPhase = "queued" | "chunking" | "embedding" | "upserting" | "done" | "error";

export interface KbExportProgressEvent {
  exportId: string;
  userId: string;
  jobId: string;
  collectionName: string;
  phase: KbExportPhase;
  embeddingDone: number;
  embeddingTotal: number;
  chunkCount: number;
  message?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
}

interface ProgressEntry {
  event: KbExportProgressEvent;
  subscribers: Set<(event: KbExportProgressEvent) => void>;
  evictAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const sweep = new Map<string, ProgressEntry>();

function evictExpired() {
  const now = Date.now();
  for (const [id, entry] of sweep) {
    if (entry.event.finishedAt && entry.evictAt < now) {
      sweep.delete(id);
    }
  }
}

const sweepTimer = setInterval(evictExpired, SWEEP_INTERVAL_MS);
if (typeof sweepTimer === "object" && sweepTimer !== null && "unref" in sweepTimer) {
  (sweepTimer as { unref: () => void }).unref();
}

export function registerKbExport(input: {
  userId: string;
  jobId: string;
  collectionName: string;
}): KbExportProgressEvent {
  evictExpired();
  const exportId = randomUUID();
  const now = Date.now();
  const event: KbExportProgressEvent = {
    exportId,
    userId: input.userId,
    jobId: input.jobId,
    collectionName: input.collectionName,
    phase: "queued",
    embeddingDone: 0,
    embeddingTotal: 0,
    chunkCount: 0,
    startedAt: now,
    updatedAt: now,
  };
  sweep.set(exportId, { event, subscribers: new Set(), evictAt: now + TTL_MS });
  return event;
}

export function updateKbExport(
  exportId: string,
  patch: Partial<Omit<KbExportProgressEvent, "exportId" | "userId" | "jobId">>,
): KbExportProgressEvent | null {
  const entry = sweep.get(exportId);
  if (!entry) return null;
  const now = Date.now();
  const next: KbExportProgressEvent = {
    ...entry.event,
    ...patch,
    exportId: entry.event.exportId,
    userId: entry.event.userId,
    jobId: entry.event.jobId,
    updatedAt: now,
  };
  if (next.phase === "done" || next.phase === "error") {
    next.finishedAt = next.finishedAt ?? now;
    entry.evictAt = now + TTL_MS;
  }
  entry.event = next;
  for (const fn of entry.subscribers) {
    try {
      fn(next);
    } catch {
      /* swallow subscriber errors */
    }
  }
  return next;
}

export function getKbExport(exportId: string, userId: string): KbExportProgressEvent | null {
  const entry = sweep.get(exportId);
  if (!entry || entry.event.userId !== userId) return null;
  return entry.event;
}

export function subscribeKbExport(
  exportId: string,
  userId: string,
  fn: (event: KbExportProgressEvent) => void,
): (() => void) | null {
  const entry = sweep.get(exportId);
  if (!entry || entry.event.userId !== userId) return null;
  entry.subscribers.add(fn);
  return () => {
    entry.subscribers.delete(fn);
  };
}
