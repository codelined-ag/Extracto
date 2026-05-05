import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { redactPii } from "@/lib/pii/redact";
import { getClientIpAddress } from "@/lib/request-security";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export const POST = withMutationAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const limited = await enforceOcrSubmitRateLimit(auth, getClientIpAddress(request));
  if (limited) return limited;
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    throw new ApiRouteError("Invalid JSON payload", 400);
  }
  const body = raw as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : "";
  if (!text) {
    throw new ApiRouteError("text is required", 400);
  }
  if (Buffer.byteLength(text, "utf-8") > MAX_TEXT_BYTES) {
    throw new ApiRouteError(`text exceeds ${MAX_TEXT_BYTES} bytes`, 413);
  }
  const result = redactPii(text);
  return NextResponse.json(result);
});
