import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";
import { db } from "@/lib/db";
import { consumeSharedRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress, isTrustedMutationRequest } from "@/lib/request-security";
import { updateUserPassword } from "@/lib/auth/credentials";

const RESET_IP_LIMIT_MAX = 30;
const RESET_WINDOW_MS = 60 * 60 * 1000;

interface ResetBody extends Record<string, unknown> {
  token?: unknown;
  newPassword?: unknown;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const ipLimit = await consumeSharedRateLimit({
      key: `auth:pw-reset:ip:${getClientIpAddress(request)}`,
      max: RESET_IP_LIMIT_MAX,
      windowMs: RESET_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const body = await parseJsonBody<ResetBody>(request);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!token) throw new ApiRouteError("token is required", 400);
    if (newPassword.length < 12) {
      throw new ApiRouteError("New password must be at least 12 characters", 400);
    }

    const provided = hashToken(token);
    const match = await db.authUser.findFirst({
      where: {
        passwordResetTokenHash: provided,
        passwordResetExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!match) throw new ApiRouteError("Invalid or expired token", 400);

    await updateUserPassword(match.id, newPassword);
    await db.authUser.update({
      where: { id: match.id },
      data: {
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
