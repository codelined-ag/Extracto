export const MIN_RETRY_BACKOFF_MS = 500;
export const MAX_RETRY_BACKOFF_MS = 30_000;
export const MAX_PAGE_RETRY_ATTEMPTS = 5;
export const MAX_RETRY_TOTAL_BUDGET_MS = 120_000;

export interface RetryClassification {
  retryable: boolean;
  reason: string;
}

// HARD-TERMINAL: never retry under any circumstance (auth, schema, abort).
const HARD_TERMINAL_PATTERNS: readonly RegExp[] = [
  /\b(401|403|404|410|422)\b/,
  /unauthor(ized|ised)/i,
  /forbidden/i,
  /invalid api key|invalid bearer|bad credentials/i,
  /MODEL_NOT_PULLED:/,
  /not[\s-]?implemented/i,
  /not[\s-]?supported/i,
  /AbortError/i,
  /OcrStopRequestedError/i,
];

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /\b(429|5\d\d)\b/,
  /timeout|timed[\s-]?out|ETIMEDOUT/i,
  /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/i,
  /rate[\s-]?limit/i,
  /temporarily unavailable/i,
  /overloaded/i,
  /upstream/i,
  /service[\s-]?unavailable/i,
  /bad gateway/i,
];

// Soft-terminal: HTTP 400 specifically. Checked AFTER transient so messages
// like "upstream returned 400" classify as transient.
const SOFT_TERMINAL_PATTERNS: readonly RegExp[] = [
  /\b400\b/,
];

export function classifyOcrError(message: string | null | undefined): RetryClassification {
  const text = (message ?? "").trim();
  if (!text) return { retryable: false, reason: "no error message" };

  for (const re of HARD_TERMINAL_PATTERNS) {
    if (re.test(text)) return { retryable: false, reason: `terminal (${re.source})` };
  }
  for (const re of TRANSIENT_PATTERNS) {
    if (re.test(text)) return { retryable: true, reason: `transient (${re.source})` };
  }
  for (const re of SOFT_TERMINAL_PATTERNS) {
    if (re.test(text)) return { retryable: false, reason: `terminal (${re.source})` };
  }
  return { retryable: false, reason: "unknown error class" };
}

export function computeBackoffMs(attempt: number): number {
  const base = MIN_RETRY_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(MAX_RETRY_BACKOFF_MS, base);
  const jitter = Math.floor(Math.random() * (capped * 0.25));
  return capped + jitter;
}

/**
 * Wrap a single provider call (typically `runProviderOcr`) with bounded
 * retries on transient failures. The classifier decides retryability;
 * terminal errors throw immediately. Each retry sleeps with exponential
 * backoff + jitter and re-runs the same closure with the same arguments.
 *
 * The caller passes its own AbortController so that a job-stop request
 * propagates and aborts the in-flight retry.
 */
export async function withProviderRetry<T>(
  call: () => Promise<T>,
  options: { maxAttempts: number; abortSignal?: AbortSignal; totalBudgetMs?: number },
): Promise<T> {
  const max = Math.max(1, Math.min(MAX_PAGE_RETRY_ATTEMPTS, options.maxAttempts));
  const budget = options.totalBudgetMs ?? MAX_RETRY_TOTAL_BUDGET_MS;
  const startedAt = Date.now();
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= max; attempt++) {
    if (options.abortSignal?.aborted) {
      throw lastError ?? new Error("Aborted");
    }
    try {
      return await call();
    } catch (err) {
      lastError = err;
      if (options.abortSignal?.aborted) throw err;
      if (attempt >= max) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const classification = classifyOcrError(message);
      if (!classification.retryable) throw err;
      if (Date.now() - startedAt > budget) throw err;
      const sleep = computeBackoffMs(attempt);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, sleep);
        if (options.abortSignal) {
          const onAbort = () => {
            clearTimeout(t);
            reject(new Error("Aborted"));
          };
          if (options.abortSignal.aborted) onAbort();
          else options.abortSignal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }
  throw lastError;
}

/**
 * Per-provider clamp on the user-configured retry count. Mistral OCR API
 * charges per call so we cap aggressively; Ollama is free so the user-set
 * value passes through.
 */
export function effectiveMaxAttempts(provider: string, userMax: number): number {
  if (provider === "mistral") return Math.min(2, Math.max(1, userMax));
  if (provider === "openrouter") return Math.min(3, Math.max(1, userMax));
  return Math.max(1, Math.min(MAX_PAGE_RETRY_ATTEMPTS, userMax));
}
