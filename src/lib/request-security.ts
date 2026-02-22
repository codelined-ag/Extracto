import { NextRequest } from "next/server";

function getRequestOrigin(request: NextRequest): string {
  return request.nextUrl.origin;
}

function safeParseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isTrustedMutationRequest(request: NextRequest): boolean {
  const expectedOrigin = getRequestOrigin(request);
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const fetchSite = (request.headers.get("sec-fetch-site") || "").trim().toLowerCase();

  if (originHeader) {
    const parsedOrigin = safeParseOrigin(originHeader);
    if (parsedOrigin !== expectedOrigin) {
      return false;
    }
  } else if (refererHeader) {
    const parsedRefererOrigin = safeParseOrigin(refererHeader);
    if (parsedRefererOrigin !== expectedOrigin) {
      return false;
    }
  } else if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return false;
  } else if (!fetchSite) {
    return false;
  }

  return true;
}

export function getClientIpAddress(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

