/**
 * Shared 60s-timeout fetch wrapper for the kb/stores/* adapters.
 * Each adapter previously inlined the AbortController + setTimeout +
 * clearTimeout dance with identical timeout, varying only in headers.
 */
export const KB_STORE_REQUEST_TIMEOUT_MS = 60_000;

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchWithTimeout(
  fetchImpl: FetchImpl,
  url: string,
  init: Omit<RequestInit, "signal"> = {},
  timeoutMs: number = KB_STORE_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
