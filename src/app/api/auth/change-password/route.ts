import { NextRequest, NextResponse } from "next/server";

import { findUserById, updateUserPassword, verifyPassword } from "@/lib/auth/credentials";
import { withSessionAuth } from "@/lib/auth/request";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import {
  createSessionToken,
  getAuthCookieName,
  getSessionMaxAgeSeconds,
  shouldUseSecureCookie,
} from "@/lib/auth/token";
import { badRequest, isRequestSecure, tooManyRequests } from "@/app/api/auth/helpers";

const MIN_PASSWORD_LENGTH = 12;
const RATE_LIMIT_IP_MAX = 20;
const RATE_LIMIT_USER_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export const POST = withSessionAuth("mutation", "Password", async (request: NextRequest, ctx) => {
  const userId = ctx.auth.userId;
  const clientIp = getClientIpAddress(request);

  const ipLimit = consumeRateLimit({
    key: `auth:change-password:ip:${clientIp}`,
    max: RATE_LIMIT_IP_MAX,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!ipLimit.allowed) {
    return tooManyRequests(ipLimit.retryAfterSeconds);
  }

  const userLimit = consumeRateLimit({
    key: `auth:change-password:user:${userId}`,
    max: RATE_LIMIT_USER_MAX,
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

  const user = await findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    return badRequest("Current password is incorrect", 401);
  }

  if (currentPassword === newPassword) {
    return badRequest("New password must be different from the current password");
  }

  await updateUserPassword(userId, newPassword);

  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    name: user.name,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: getAuthCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookie(isRequestSecure(request)),
    path: "/",
    maxAge: getSessionMaxAgeSeconds(),
  });

  return response;
});
