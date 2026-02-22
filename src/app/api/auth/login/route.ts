import { NextRequest, NextResponse } from "next/server";

import { findUserByEmail, toSafeUser, verifyPassword } from "@/lib/auth/credentials";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress, isTrustedMutationRequest } from "@/lib/request-security";
import {
  createSessionToken,
  getAuthCookieName,
  getSessionMaxAgeSeconds,
  shouldUseSecureCookie,
} from "@/lib/auth/token";

const LOGIN_IP_LIMIT_MAX = 20;
const LOGIN_EMAIL_LIMIT_MAX = 10;
const LOGIN_WINDOW_MS = 60_000;

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isRequestSecure(request: NextRequest): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = (forwardedProto ? forwardedProto.split(",")[0].trim() : request.nextUrl.protocol)
    .replace(":", "");

  return protocol === "https";
}

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": `${retryAfterSeconds}`,
      },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!isTrustedMutationRequest(request)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const clientIp = getClientIpAddress(request);
    const ipLimit = consumeRateLimit({
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

    const emailLimit = consumeRateLimit({
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

    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    const response = NextResponse.json({
      user: toSafeUser(user),
      success: true,
    });

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
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Unable to sign in" }, { status: 500 });
  }
}
