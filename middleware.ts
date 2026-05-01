import { NextRequest, NextResponse } from "next/server";

import { getAuthCookieName, verifySessionToken } from "@/lib/auth/token";

const JSON_HEADERS = { "content-type": "application/json" };
const PUBLIC_PATHS = [
  "/auth",
  "/api/auth",
  "/api/health",
  "/manifest.webmanifest",
  "/sw.js",
  "/extracto-favicon.svg",
  "/extracto-icon.svg",
  "/extracto-maskable.svg",
  "/logo.svg",
  "/robots.txt",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") {
    return false;
  }

  if (pathname.startsWith("/_next")) {
    return true;
  }

  return PUBLIC_PATHS.some((publicPath) =>
    pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(getAuthCookieName())?.value;
  const session = await verifySessionToken(token);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: JSON_HEADERS }
      );
    }

    return NextResponse.redirect(new URL("/auth", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
