import { handleApiError, ApiRouteError } from "@/lib/api-error";
import type { AuthContext } from "@/lib/auth/request";
import { consumeSharedRateLimit } from "@/lib/rate-limit";
import type { NextResponse } from "next/server";

export const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
export const OCR_RATE_LIMIT_MAX = 6;
export const S3_READ_RATE_LIMIT_MAX = 60;
export const S3_WRITE_RATE_LIMIT_MAX = 12;
export const WEBHOOK_TEST_RATE_LIMIT_MAX = 6;

export async function enforceOcrSubmitRateLimit(auth: AuthContext, clientIp: string): Promise<NextResponse | null> {
  const rateLimitKey =
    auth.method === "api-key" && auth.apiKeyId
      ? `ocr:job:key:${auth.apiKeyId}`
      : `ocr:job:${auth.userId}:${clientIp}`;
  const rateLimitMax =
    auth.method === "api-key" && auth.rateLimitPerMinute && auth.rateLimitPerMinute > 0
      ? auth.rateLimitPerMinute
      : OCR_RATE_LIMIT_MAX;
  const rateLimit = await consumeSharedRateLimit({
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

export async function enforceWebhookTestRateLimit(
  auth: AuthContext,
  clientIp: string,
): Promise<NextResponse | null> {
  const rateLimitKey =
    auth.method === "api-key" && auth.apiKeyId
      ? `webhook:test:key:${auth.apiKeyId}`
      : `webhook:test:${auth.userId}:${clientIp}`;
  const rateLimit = await consumeSharedRateLimit({
    key: rateLimitKey,
    max: WEBHOOK_TEST_RATE_LIMIT_MAX,
    windowMs: OCR_RATE_LIMIT_WINDOW_MS,
  });
  if (rateLimit.allowed) return null;
  return handleApiError(
    new ApiRouteError("Too many webhook test deliveries. Retry shortly.", 429),
    { headers: { "Retry-After": `${rateLimit.retryAfterSeconds}` } },
  );
}

export async function enforceS3RateLimit(
  auth: AuthContext,
  clientIp: string,
  kind: "read" | "write",
): Promise<NextResponse | null> {
  const max = kind === "read" ? S3_READ_RATE_LIMIT_MAX : S3_WRITE_RATE_LIMIT_MAX;
  const rateLimitKey =
    auth.method === "api-key" && auth.apiKeyId
      ? `s3:${kind}:key:${auth.apiKeyId}`
      : `s3:${kind}:${auth.userId}:${clientIp}`;
  const rateLimit = await consumeSharedRateLimit({ key: rateLimitKey, max, windowMs: OCR_RATE_LIMIT_WINDOW_MS });
  if (rateLimit.allowed) return null;
  return handleApiError(
    new ApiRouteError(`Too many S3 ${kind} requests. Retry shortly.`, 429),
    { headers: { "Retry-After": `${rateLimit.retryAfterSeconds}` } },
  );
}
