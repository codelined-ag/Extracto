import { NextRequest } from "next/server";

function parseHeaderFirstValue(value: string | null): string {
  if (!value) return "";
  return value.split(",")[0]?.trim() || "";
}

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function shouldTrustForwardedProxyHeaders(): boolean {
  return envFlagEnabled(process.env.TRUSTED_PROXY_HEADERS);
}

function safeParseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeOriginForComparison(origin: string): string {
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.trim().toLowerCase();
    const normalizedHost =
      hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0"
        ? "localhost"
        : hostname;
    const protocol = parsed.protocol.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${protocol}//${normalizedHost}${port}`;
  } catch {
    return origin.trim().toLowerCase();
  }
}

function getExpectedOrigins(request: NextRequest): Set<string> {
  const origins = new Set<string>();
  origins.add(normalizeOriginForComparison(request.nextUrl.origin));

  const trustForwarded = shouldTrustForwardedProxyHeaders();
  const forwardedProto = trustForwarded
    ? parseHeaderFirstValue(request.headers.get("x-forwarded-proto"))
      .replace(/:$/u, "")
      .toLowerCase()
    : "";
  const forwardedHost = trustForwarded
    ? parseHeaderFirstValue(request.headers.get("x-forwarded-host"))
    : "";
  const hostHeader = parseHeaderFirstValue(request.headers.get("host"));
  const host = forwardedHost || hostHeader || request.nextUrl.host;
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "");

  if (host) {
    origins.add(normalizeOriginForComparison(`${proto}://${host}`));
  }

  return origins;
}

function originMatchesExpected(origin: string, expectedOrigins: Set<string>): boolean {
  const normalizedOrigin = normalizeOriginForComparison(origin);
  return expectedOrigins.has(normalizedOrigin);
}

export function isTrustedMutationRequest(request: NextRequest): boolean {
  const expectedOrigins = getExpectedOrigins(request);
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const fetchSite = (request.headers.get("sec-fetch-site") || "").trim().toLowerCase();

  if (originHeader) {
    const parsedOrigin = safeParseOrigin(originHeader);
    if (!parsedOrigin || !originMatchesExpected(parsedOrigin, expectedOrigins)) {
      return false;
    }
  } else if (refererHeader) {
    const parsedRefererOrigin = safeParseOrigin(refererHeader);
    if (!parsedRefererOrigin || !originMatchesExpected(parsedRefererOrigin, expectedOrigins)) {
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
  if (shouldTrustForwardedProxyHeaders()) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }

    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }

  return "unknown";
}
