const ocrJobStopRequests = new Set<string>();
const ocrRunningJobs = new Set<string>();

export function markOcrJobRunning(jobId: string): void {
  ocrRunningJobs.add(jobId);
}

export function clearOcrJobRunning(jobId: string): void {
  ocrRunningJobs.delete(jobId);
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
