import { NextRequest, NextResponse } from "next/server";

import { getAuthCookieName, shouldUseSecureCookie } from "@/lib/auth/token";

export async function POST(_request: NextRequest) {
  const forwardedProto = _request.headers.get("x-forwarded-proto");
  const protocol = (forwardedProto ? forwardedProto.split(",")[0].trim() : _request.nextUrl.protocol)
    .replace(":", "");
  const isRequestSecure = protocol === "https";

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: getAuthCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(isRequestSecure),
    path: "/",
    maxAge: 0,
  });

  return response;
}
