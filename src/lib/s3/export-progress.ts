import { randomUUID } from "node:crypto";

export type S3ExportPhase = "queued" | "reading" | "uploading" | "done" | "error";

export interface S3ExportProgressEvent {
  exportId: string;
  userId: string;
  jobId: string;
  bucket: string;
  keys: string[];
  phase: S3ExportPhase;
  totalBytes: number;
  uploadedBytes: number;
  message?: string;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
}

interface ProgressEntry {
  event: S3ExportProgressEvent;
  subscribers: Set<(event: S3ExportProgressEvent) => void>;
  evictAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const sweep = new Map<string, ProgressEntry>();

function evictExpired() {
  const now = Date.now();
  for (const [id, entry] of sweep) {
    if (entry.event.finishedAt && entry.evictAt < now) sweep.delete(id);
  }
}

const sweepTimer = setInterval(evictExpired, SWEEP_INTERVAL_MS);
if (typeof sweepTimer === "object" && sweepTimer !== null && "unref" in sweepTimer) {
  (sweepTimer as { unref: () => void }).unref();
}

export function registerS3Export(input: { userId: string; jobId: string; bucket: string }): S3ExportProgressEvent {
  evictExpired();
  const exportId = randomUUID();
  const now = Date.now();
  const event: S3ExportProgressEvent = {
    exportId,
    userId: input.userId,
    jobId: input.jobId,
    bucket: input.bucket,
    keys: [],
    phase: "queued",
    totalBytes: 0,
    uploadedBytes: 0,
    startedAt: now,
    updatedAt: now,
  };
  sweep.set(exportId, { event, subscribers: new Set(), evictAt: now + TTL_MS });
  return event;
}

export function updateS3Export(
  exportId: string,
  patch: Partial<Omit<S3ExportProgressEvent, "exportId" | "userId" | "jobId">>,
): S3ExportProgressEvent | null {
  const entry = sweep.get(exportId);
  if (!entry) return null;
  const now = Date.now();
  const next: S3ExportProgressEvent = {
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
    try { fn(next); } catch { /* swallow */ }
  }
  return next;
}

export function getS3Export(exportId: string, userId: string): S3ExportProgressEvent | null {
  const entry = sweep.get(exportId);
  if (!entry || entry.event.userId !== userId) return null;
  return entry.event;
}

export function subscribeS3Export(
  exportId: string,
  userId: string,
  fn: (event: S3ExportProgressEvent) => void,
): (() => void) | null {
  const entry = sweep.get(exportId);
  if (!entry || entry.event.userId !== userId) return null;
  entry.subscribers.add(fn);
  return () => { entry.subscribers.delete(fn); };
}
