import { NextRequest } from "next/server";

export function buildOcrForwardHeaders(request: NextRequest): Record<string, string> {
  const origin = request.nextUrl.origin;
  const cookie = request.headers.get("cookie") || "";
  const authHeader = request.headers.get("authorization") || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: origin,
    Referer: origin,
  };
  if (cookie) headers.Cookie = cookie;
  if (authHeader) headers.Authorization = authHeader;
  return headers;
}
