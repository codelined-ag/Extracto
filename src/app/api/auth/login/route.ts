import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-error";
import { findUserByEmail, toSafeUser, verifyPassword } from "@/lib/auth/credentials";
import { consumeSharedRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress, isTrustedMutationRequest } from "@/lib/request-security";
import {
  createSessionToken,
  getAuthCookieName,
  getSessionMaxAgeSeconds,
  shouldUseSecureCookie,
} from "@/lib/auth/token";
import { createTwoFactorChallengeToken } from "@/lib/auth/two-factor-challenge";
import { badRequest, isRequestSecure, normalizeEmail, tooManyRequests } from "@/app/api/auth/helpers";

const LOGIN_IP_LIMIT_MAX = 20;
const LOGIN_EMAIL_LIMIT_MAX = 10;
const LOGIN_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const clientIp = getClientIpAddress(request);
    const ipLimit = await consumeSharedRateLimit({
      key: `auth:login:ip:${clientIp}`,
      max: LOGIN_IP_LIMIT_MAX,
      windowMs: LOGIN_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return tooManyRequests(ipLimit.retryAfterSeconds);
    }

    const body = (await request.json().catch(() => null)) as
      | {
          email?: unknown;
          password?: unknown;
        }
      | null;

    if (!body || typeof body !== "object") {
      return badRequest("Invalid request body");
    }

    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";

    const emailLimit = await consumeSharedRateLimit({
      key: `auth:login:email:${email || "unknown"}`,
      max: LOGIN_EMAIL_LIMIT_MAX,
      windowMs: LOGIN_WINDOW_MS,
    });
    if (!emailLimit.allowed) {
      return tooManyRequests(emailLimit.retryAfterSeconds);
    }

    if (!email || !password || password.length < 8) {
      return badRequest("Email and password (minimum 8 chars) are required");
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return badRequest("Invalid credentials", 401);
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return badRequest("Invalid credentials", 401);
    }

    if (user.totpEnabled) {
      const challengeToken = createTwoFactorChallengeToken({
        userId: user.id,
        email: user.email,
      });
      return NextResponse.json({ requires2fa: true, challengeToken });
    }

    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      pv: user.passwordChangedAt.getTime(),
    });

    const response = NextResponse.json({ user: toSafeUser(user) });

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
  } catch (error) {
    return handleApiError(error);
  }
}
