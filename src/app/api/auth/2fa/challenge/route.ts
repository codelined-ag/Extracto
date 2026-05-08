import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-error";
import { findUserById, toSafeUser } from "@/lib/auth/credentials";
import { consumeSharedRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress, isTrustedMutationRequest } from "@/lib/request-security";
import {
  createSessionToken,
  getAuthCookieName,
  getSessionMaxAgeSeconds,
  shouldUseSecureCookie,
} from "@/lib/auth/token";
import { consumeTwoFactorChallengeJti, verifyTwoFactorChallengeToken } from "@/lib/auth/two-factor-challenge";
import { verifyTotpForUser } from "@/lib/auth/totp";
import { badRequest, isRequestSecure, tooManyRequests } from "@/app/api/auth/helpers";

const CHALLENGE_IP_LIMIT_MAX = 30;
const CHALLENGE_USER_LIMIT_MAX = 10;
const CHALLENGE_WINDOW_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const clientIp = getClientIpAddress(request);
    const ipLimit = await consumeSharedRateLimit({
      key: `auth:2fa:ip:${clientIp}`,
      max: CHALLENGE_IP_LIMIT_MAX,
      windowMs: CHALLENGE_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return tooManyRequests(ipLimit.retryAfterSeconds);
    }

    const body = (await request.json().catch(() => null)) as
      | { challengeToken?: unknown; code?: unknown }
      | null;
    if (!body || typeof body !== "object") return badRequest("Invalid request body");

    const challengeToken = typeof body.challengeToken === "string" ? body.challengeToken : "";
    const code = typeof body.code === "string" ? body.code : "";
    if (!challengeToken || !code) return badRequest("challengeToken and code are required");

    const claims = verifyTwoFactorChallengeToken(challengeToken);
    if (!claims) return badRequest("Invalid or expired challenge", 401);

    const userLimit = await consumeSharedRateLimit({
      key: `auth:2fa:user:${claims.userId}`,
      max: CHALLENGE_USER_LIMIT_MAX,
      windowMs: CHALLENGE_WINDOW_MS,
    });
    if (!userLimit.allowed) {
      return tooManyRequests(userLimit.retryAfterSeconds);
    }

    const verified = await verifyTotpForUser(claims.userId, code);
    if (!verified) {
      return badRequest("Invalid verification code", 401);
    }

    if (!consumeTwoFactorChallengeJti(claims.jti, claims.exp)) {
      return badRequest("Challenge already used. Sign in again.", 401);
    }

    const user = await findUserById(claims.userId);
    if (!user) return badRequest("User not found", 401);

    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      pv: user.passwordChangedAt.getTime(),
    });
    const response = NextResponse.json({ user: toSafeUser(user), via: verified });
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
