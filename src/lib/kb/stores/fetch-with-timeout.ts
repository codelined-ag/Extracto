/**
 * Shared 60s-timeout fetch wrapper for the kb/stores/* adapters.
 * Each adapter previously inlined the AbortController + setTimeout +
 * clearTimeout dance with identical timeout, varying only in headers.
 */
export const KB_STORE_REQUEST_TIMEOUT_MS = 60_000;
export const KB_STORE_MAX_ATTEMPTS = 3;
export const KB_STORE_BASE_BACKOFF_MS = 500;
export const KB_STORE_MAX_BACKOFF_MS = 8_000;

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

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, KB_STORE_MAX_BACKOFF_MS);
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.min(delta, KB_STORE_MAX_BACKOFF_MS);
  }
  return null;
}

function backoffMs(attempt: number): number {
  const base = KB_STORE_BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * KB_STORE_BASE_BACKOFF_MS;
  return Math.min(base + jitter, KB_STORE_MAX_BACKOFF_MS);
}

export async function fetchWithRetry(
  fetchImpl: FetchImpl,
  url: string,
  init: Omit<RequestInit, "signal"> = {},
  options: { timeoutMs?: number; maxAttempts?: number } = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? KB_STORE_MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, init, options.timeoutMs);
      if (response.status === 429) {
        if (attempt === maxAttempts - 1) return response;
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        await new Promise((resolve) => setTimeout(resolve, retryAfter ?? backoffMs(attempt)));
        continue;
      }
      if (response.status >= 500 && response.status !== 501 && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
    }
  }
  throw lastError ?? new Error("Vector store request failed after retries");
}
