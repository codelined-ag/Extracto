import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { createUser, findUserByEmail, toSafeUser } from "@/lib/auth/credentials";
import {
  createSessionToken,
  getAuthCookieName,
  getSessionMaxAgeSeconds,
  shouldUseSecureCookie,
} from "@/lib/auth/token";

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

export async function POST(request: NextRequest) {
  try {
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

    if (!email || !password || password.length < 8) {
      return badRequest("Email and password (minimum 8 chars) are required");
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
    });

    const response = NextResponse.json({
      user: toSafeUser(user),
      success: true,
    });

    response.cookies.set({
      name: getAuthCookieName(),
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(isRequestSecure(request)),
      path: "/",
      maxAge: getSessionMaxAgeSeconds(),
    });

    return response;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return badRequest("Email already registered", 409);
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Unable to create account" }, { status: 500 });
  }
}
