import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";

import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { verifyPassword, normalizeEmail } from "@/lib/auth/credentials";
import { verifyTotpForUser } from "@/lib/auth/totp";
import { getPublicBaseUrl, isSmtpConfigured, sendSystemEmail } from "@/lib/auth/smtp";

interface PatchEmailBody extends Record<string, unknown> {
  newEmail?: unknown;
  password?: unknown;
  code?: unknown;
}

const TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const PATCH = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  try {
    const body = await parseJsonBody<PatchEmailBody>(request);
    const newEmail = typeof body.newEmail === "string" ? normalizeEmail(body.newEmail) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const code = typeof body.code === "string" ? body.code : "";

    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      throw new ApiRouteError("newEmail must be a valid email", 400);
    }
    if (!password) {
      throw new ApiRouteError("password is required", 400);
    }

    const user = await db.authUser.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, passwordHash: true, totpEnabled: true },
    });
    if (!user) throw new ApiRouteError("User not found", 404);
    if (!verifyPassword(password, user.passwordHash)) {
      throw new ApiRouteError("Invalid password", 401);
    }
    if (newEmail === user.email) {
      throw new ApiRouteError("New email must differ from the current email", 400);
    }
    if (user.totpEnabled) {
      if (!code) throw new ApiRouteError("Two-factor code is required", 401);
      const verified = await verifyTotpForUser(user.id, code);
      if (!verified) throw new ApiRouteError("Invalid verification code", 401);
    }

    const collision = await db.authUser.findUnique({ where: { email: newEmail }, select: { id: true } });
    if (collision) {
      throw new ApiRouteError("That email is already in use", 409);
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    await db.authUser.update({
      where: { id: user.id },
      data: {
        pendingEmail: newEmail,
        emailChangeTokenHash: hashToken(token),
        emailChangeExpiresAt: expiresAt,
      },
    });

    const link = `${getPublicBaseUrl()}/auth/confirm-email?token=${token}`;
    let mailDelivered = false;
    if (isSmtpConfigured()) {
      const send = await sendSystemEmail({
        to: newEmail,
        subject: "Confirm your new Extracto email",
        text:
          `Confirm the email change for ${user.email} to ${newEmail} by visiting:\n\n${link}\n\n` +
          `The link expires in 30 minutes. Ignore this message if you did not request the change.`,
      });
      mailDelivered = send.delivered;
    }

    return NextResponse.json({
      pendingEmail: newEmail,
      expiresAt: expiresAt.toISOString(),
      mailDelivered,
      ...(mailDelivered ? {} : { confirmUrl: link }),
    });
  } catch (error) {
    return handleApiError(error);
  }
});
