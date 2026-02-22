const ocrJobStopRequests = new Set<string>();
const ocrRunningJobs = new Set<string>();
const ocrAbortControllers = new Map<string, Set<AbortController>>();

export function markOcrJobRunning(jobId: string): void {
  ocrRunningJobs.add(jobId);
}

export function clearOcrJobRunning(jobId: string): void {
  ocrRunningJobs.delete(jobId);
  ocrAbortControllers.delete(jobId);
}

export function isOcrJobRunning(jobId: string): boolean {
  return ocrRunningJobs.has(jobId);
}

export function requestOcrJobStop(jobId: string): void {
  ocrJobStopRequests.add(jobId);
}

export function clearOcrJobStop(jobId: string): void {
  ocrJobStopRequests.delete(jobId);
}

export function isOcrJobStopRequested(jobId: string): boolean {
  return ocrJobStopRequests.has(jobId);
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
    try {
      controller.abort();
    } catch {
      // noop
    }
  }
  ocrAbortControllers.delete(jobId);
}
