import { handleApiError, ApiRouteError } from "@/lib/api-error";
import type { AuthContext } from "@/lib/auth/request";
import { consumeRateLimit } from "@/lib/rate-limit";
import type { NextResponse } from "next/server";

export const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
export const OCR_RATE_LIMIT_MAX = 6;

export function enforceOcrSubmitRateLimit(auth: AuthContext, clientIp: string): NextResponse | null {
  const rateLimitKey =
    auth.method === "api-key" && auth.apiKeyId
      ? `ocr:job:key:${auth.apiKeyId}`
      : `ocr:job:${auth.userId}:${clientIp}`;
  const rateLimitMax =
    auth.method === "api-key" && auth.rateLimitPerMinute && auth.rateLimitPerMinute > 0
      ? auth.rateLimitPerMinute
      : OCR_RATE_LIMIT_MAX;
  const rateLimit = consumeRateLimit({
    key: rateLimitKey,
    max: rateLimitMax,
    windowMs: OCR_RATE_LIMIT_WINDOW_MS,
  });
  if (rateLimit.allowed) return null;
  return handleApiError(
    new ApiRouteError("Too many OCR jobs requested. Please retry shortly.", 429),
    { headers: { "Retry-After": `${rateLimit.retryAfterSeconds}` } },
  );
}
