import { NextRequest, NextResponse } from "next/server";

import { extractBearerToken, isLikelyApiKey } from "@/lib/auth/api-key-shared";
import { getAuthCookieName } from "@/lib/auth/token";
import { verifyActiveSession } from "@/lib/auth/session";

const JSON_HEADERS = { "content-type": "application/json" };
const PUBLIC_PATHS = [
  "/auth",
  "/api/auth",
  "/api/health",
  "/api/integrations/dropbox/callback",
  "/api/integrations/google_drive/callback",
  "/api/integrations/onedrive/callback",
  // /api/v1/metrics has its own METRICS_TOKEN bearer scheme — the middleware's
  // extr_-prefixed bearer check would reject it before the route runs. The
  // route itself does the constant-time token check.
  "/api/v1/metrics",
  "/api/v1/docs",
  "/api/v1/openapi.yaml",
  "/manifest.webmanifest",
  "/sw.js",
  "/extracto-favicon.svg",
  "/extracto-icon.svg",
  "/extracto-maskable.svg",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
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
  const session = await verifyActiveSession(token);

  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    const bearer = extractBearerToken(request.headers.get("authorization"));
    if (bearer && isLikelyApiKey(bearer)) {
      return NextResponse.next();
    }

    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: JSON_HEADERS }
    );
  }

  return NextResponse.redirect(new URL("/auth", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
  runtime: "nodejs",
};
