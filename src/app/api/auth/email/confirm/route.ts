import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";
import { db } from "@/lib/db";
import { isTrustedMutationRequest } from "@/lib/request-security";

interface ConfirmBody extends Record<string, unknown> {
  token?: unknown;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const body = await parseJsonBody<ConfirmBody>(request);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) throw new ApiRouteError("token is required", 400);

    const candidates = await db.authUser.findMany({
      where: {
        pendingEmail: { not: null },
        emailChangeExpiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        pendingEmail: true,
        emailChangeTokenHash: true,
        emailChangeExpiresAt: true,
      },
    });

    const provided = hashToken(token);
    const match = candidates.find(
      (c) => c.emailChangeTokenHash && constantTimeEq(c.emailChangeTokenHash, provided),
    );
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
      },
    });

    return NextResponse.json({ email: match.pendingEmail });
  } catch (error) {
    return handleApiError(error);
  }
}

