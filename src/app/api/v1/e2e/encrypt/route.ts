import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { encryptForUser } from "@/lib/e2e/envelope";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export const POST = withMutationAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const limited = await enforceOcrSubmitRateLimit(auth, getClientIpAddress(request));
  if (limited) return limited;
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    throw new ApiRouteError("Invalid JSON payload", 400);
  }
  const text = typeof (raw as { text?: unknown }).text === "string" ? (raw as { text: string }).text : "";
  if (!text) {
    throw new ApiRouteError("text is required", 400);
  }
  if (Buffer.byteLength(text, "utf-8") > MAX_TEXT_BYTES) {
    throw new ApiRouteError(`text exceeds ${MAX_TEXT_BYTES} bytes`, 413);
  }
  const row = await db.authUser.findUnique({
    where: { id: auth.userId },
    select: { e2ePublicKeyPem: true },
  });
  if (!row?.e2ePublicKeyPem) {
    throw new ApiRouteError("No E2E public key registered for this user", 409);
  }
  try {
    const envelope = encryptForUser(Buffer.from(text, "utf-8"), row.e2ePublicKeyPem);
    return NextResponse.json(envelope);
  } catch (err) {
    throw new ApiRouteError(`Encryption failed: ${(err as Error).message}`, 500);
  }
});
