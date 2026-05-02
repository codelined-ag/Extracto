import { NextResponse } from "next/server";

/**
 * Pull a string message out of an unknown caught value. Replaces the
 * `error instanceof Error ? error.message : fallback` ternary that was
 * repeated 22+ times across handlers and provider runners.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// Helper for the common pattern of parsing a request body that may fail.
// Returns a Partial<T> so the call site narrows individual fields with
// typeof guards. Centralizing this in one place lets us swap the parsing
// strategy (e.g. add Zod validation) without touching every handler.
export async function parseJsonBody<T extends Record<string, unknown>>(
  request: { json: () => Promise<unknown> },
): Promise<Partial<T>> {
  try {
    const raw = await request.json();
    return (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Partial<T>;
  } catch {
    return {};
  }
}

export class ApiRouteError extends Error {
  public status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiRouteError";
    this.status = status;
  }
}

export interface HandleApiErrorOptions {
  /**
   * Optional mapper from a non-ApiRouteError to an HTTP status code. The
   * default is 500. ApiRouteError always wins (its `.status` is honored
   * regardless of this mapper). Return `undefined` to fall back to 500.
   *
   * Useful for routes that want to map specific error classes to specific
   * statuses — e.g. AbortError -> 504, TypeError -> 502 — without a wide
   * try/catch ladder at every call site.
   */
  statusFor?: (error: unknown) => number | undefined;
  /**
   * Extra fields merged into the JSON response body. Useful when a route
   * has a domain-specific error envelope (e.g. `success: false`,
   * `attemptedHosts: [...]`).
   */
  extra?: Record<string, unknown>;
  /**
   * Extra response headers (e.g. `Retry-After` for 429 responses). Merged
   * with the JSON content-type Next.js sets automatically.
   */
  headers?: Record<string, string>;
}

export function handleApiError(error: unknown, options: HandleApiErrorOptions = {}): NextResponse {
  const status =
    error instanceof ApiRouteError
      ? error.status
      : options.statusFor?.(error) ?? 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  // Spread `extra` first so the canonical `error` field cannot be overwritten
  // by a caller-supplied entry — the message must always reflect the real
  // exception, never a fake.
  return NextResponse.json(
    { ...options.extra, error: message },
    { status, ...(options.headers ? { headers: options.headers } : {}) }
  );
}

/**
 * Status mapper used by long-running pipelines (OCR, KB export) where
 * upstream timeouts and TypeErrors carry domain meaning beyond a generic
 * 500. Pass via { statusFor } to handleApiError.
 */
export function pipelineStatusFor(error: unknown): number | undefined {
  if (error instanceof Error) {
    if (error.name === "AbortError") return 504;
    if (error instanceof TypeError) return 502;
  }
  return undefined;
}
