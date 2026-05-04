import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { handleApiError } from "@/lib/api-error";
import { createUser, findUserByEmail, toSafeUser } from "@/lib/auth/credentials";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress, isTrustedMutationRequest } from "@/lib/request-security";
import {
  createSessionToken,
  getAuthCookieName,
  getSessionMaxAgeSeconds,
  shouldUseSecureCookie,
} from "@/lib/auth/token";
import { badRequest, isRequestSecure, normalizeEmail, tooManyRequests } from "@/app/api/auth/helpers";

const SIGNUP_IP_LIMIT_MAX = 10;
const SIGNUP_EMAIL_LIMIT_MAX = 5;
const SIGNUP_WINDOW_MS = 60_000;
const MIN_PASSWORD_LENGTH = 12;

function isSignupAllowed(): boolean {
  const flag = (process.env.ALLOW_SIGNUP ?? "1").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    if (!isSignupAllowed()) {
      return NextResponse.json(
        { error: "Account registration is disabled on this instance." },
        { status: 403 },
      );
    }

    const clientIp = getClientIpAddress(request);
    const ipLimit = consumeRateLimit({
      key: `auth:signup:ip:${clientIp}`,
      max: SIGNUP_IP_LIMIT_MAX,
      windowMs: SIGNUP_WINDOW_MS,
    });
    if (!ipLimit.allowed) {
      return tooManyRequests(ipLimit.retryAfterSeconds);
    }

    const body = (await request.json().catch(() => null)) as
      | {
          email?: unknown;
          password?: unknown;
          name?: unknown;
        }
      | null;

    if (!body || typeof body !== "object") {
      return badRequest("Invalid request body");
    }

    const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
    const password = typeof body.password === "string" ? body.password : "";
    const name = typeof body.name === "string" ? body.name : "";

    const emailLimit = consumeRateLimit({
      key: `auth:signup:email:${email || "unknown"}`,
      max: SIGNUP_EMAIL_LIMIT_MAX,
      windowMs: SIGNUP_WINDOW_MS,
    });
    if (!emailLimit.allowed) {
      return tooManyRequests(emailLimit.retryAfterSeconds);
    }

    if (!email || !password || password.length < MIN_PASSWORD_LENGTH) {
      return badRequest(`Email and password (minimum ${MIN_PASSWORD_LENGTH} chars) are required`);
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return badRequest("Email already registered", 409);
    }

    const user = await createUser({
      email,
      password,
      name,
    });

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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return badRequest("Email already registered", 409);
    }
    return handleApiError(error);
  }
}
