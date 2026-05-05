import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";

import { handleApiError } from "@/lib/api-error";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/credentials";
import { consumeSharedRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress, isTrustedMutationRequest } from "@/lib/request-security";
import { getPublicBaseUrl, isSmtpConfigured, sendSystemEmail } from "@/lib/auth/smtp";

const FORGOT_IP_LIMIT_MAX = 10;
const FORGOT_EMAIL_LIMIT_MAX = 4;
const FORGOT_WINDOW_MS = 60 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }
    const clientIp = getClientIpAddress(request);
    const ipLimit = await consumeSharedRateLimit({
      key: `auth:pw-forgot:ip:${clientIp}`,
      max: FORGOT_IP_LIMIT_MAX,
      windowMs: FORGOT_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = body && typeof body.email === "string" ? normalizeEmail(body.email) : "";

    const smtpConfigured = isSmtpConfigured();
    const expose = !smtpConfigured && process.env.NODE_ENV !== "production";

    const stableShape = (extra?: { mailDelivered?: boolean; confirmUrl?: string }) =>
      NextResponse.json({
        ok: true,
        mailDelivered: extra?.mailDelivered === true,
        smtpConfigured,
        ...(expose
          ? {
              confirmUrl:
                extra?.confirmUrl ??
                `${getPublicBaseUrl()}/auth/reset?token=${randomBytes(32).toString("base64url")}`,
            }
          : {}),
      });

    if (!email) {
      return stableShape();
    }

    const emailLimit = await consumeSharedRateLimit({
      key: `auth:pw-forgot:email:${email}`,
      max: FORGOT_EMAIL_LIMIT_MAX,
      windowMs: FORGOT_WINDOW_MS,
    });
    if (!emailLimit.allowed) {
      return stableShape();
    }

    const user = await db.authUser.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    let mailDelivered = false;
    let leakSafeConfirmUrl: string | undefined;

    if (user) {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      await db.authUser.update({
        where: { id: user.id },
        data: {
          passwordResetTokenHash: hashToken(token),
          passwordResetExpiresAt: expiresAt,
        },
      });
      const link = `${getPublicBaseUrl()}/auth/reset?token=${token}`;
      if (isSmtpConfigured()) {
        const send = await sendSystemEmail({
          to: user.email,
          subject: "Reset your Extracto password",
          text:
            `Reset your Extracto password by visiting:\n\n${link}\n\n` +
            `The link expires in 30 minutes. Ignore this message if you did not request a reset.`,
        });
        mailDelivered = send.delivered;
      } else {
        console.log(`[auth.password.forgot] SMTP unconfigured; reset link for ${user.email}: ${link}`);
        if (expose) leakSafeConfirmUrl = link;
      }
    }

    return stableShape({ mailDelivered, confirmUrl: leakSafeConfirmUrl });
  } catch (error) {
    return handleApiError(error);
  }
}
