import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-error";
import { authenticateMutation } from "@/lib/auth/request";
import { findUserById, updateUserPassword, verifyPassword } from "@/lib/auth/credentials";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import { badRequest, tooManyRequests } from "@/app/api/auth/helpers";

const MIN_PASSWORD_LENGTH = 12;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateMutation(request);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    if (authResult.auth.method !== "session") {
      return NextResponse.json(
        { error: "Password changes require a logged-in session, not an API key." },
        { status: 403 },
      );
    }

    const userId = authResult.auth.userId;
    const clientIp = getClientIpAddress(request);

    const ipLimit = consumeRateLimit({
      key: `auth:change-password:ip:${clientIp}`,
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return tooManyRequests(ipLimit.retryAfterSeconds);
    }

    const userLimit = consumeRateLimit({
      key: `auth:change-password:user:${userId}`,
      max: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    if (!userLimit.allowed) {
      return tooManyRequests(userLimit.retryAfterSeconds);
    }

    const body = (await request.json().catch(() => null)) as
      | {
          currentPassword?: unknown;
          newPassword?: unknown;
        }
      | null;

    if (!body || typeof body !== "object") {
      return badRequest("Invalid request body");
    }

    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    if (!currentPassword || !newPassword) {
      return badRequest("Current and new passwords are required");
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return badRequest(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    if (currentPassword === newPassword) {
      return badRequest("New password must be different from the current password");
    }

    const user = await findUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return badRequest("Current password is incorrect", 401);
    }

    await updateUserPassword(userId, newPassword);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
