import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";
import { db } from "@/lib/db";
import { consumeSharedRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress, isTrustedMutationRequest } from "@/lib/request-security";

interface ConfirmBody extends Record<string, unknown> {
  token?: unknown;
}

const CONFIRM_IP_LIMIT_MAX = 30;
const CONFIRM_WINDOW_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const ipLimit = await consumeSharedRateLimit({
      key: `auth:email-confirm:ip:${getClientIpAddress(request)}`,
      max: CONFIRM_IP_LIMIT_MAX,
      windowMs: CONFIRM_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const body = await parseJsonBody<ConfirmBody>(request);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) throw new ApiRouteError("token is required", 400);

    const provided = hashToken(token);
    const match = await db.authUser.findFirst({
      where: {
        emailChangeTokenHash: provided,
        emailChangeExpiresAt: { gt: new Date() },
        pendingEmail: { not: null },
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
      },
    });
    if (!match || !match.pendingEmail) {
      throw new ApiRouteError("Invalid or expired token", 400);
    }

    const collision = await db.authUser.findFirst({
      where: { email: match.pendingEmail, NOT: { id: match.id } },
      select: { id: true },
    });
    if (collision) {
      await db.authUser.update({
        where: { id: match.id },
        data: {
          pendingEmail: null,
          emailChangeTokenHash: null,
          emailChangeExpiresAt: null,
        },
      });
      throw new ApiRouteError("That email was claimed by another account; change cancelled", 409);
    }

    await db.authUser.update({
      where: { id: match.id },
      data: {
        email: match.pendingEmail,
        pendingEmail: null,
        emailChangeTokenHash: null,
        emailChangeExpiresAt: null,
        passwordChangedAt: new Date(),
      },
    });

    return NextResponse.json({ email: match.pendingEmail });
  } catch (error) {
    return handleApiError(error);
  }
}

