import { NextRequest, NextResponse } from "next/server";

import { getAuthCookieName, shouldUseSecureCookie } from "@/lib/auth/token";
import { isTrustedMutationRequest } from "@/lib/request-security";

export function POST(_request: NextRequest) {
  if (!isTrustedMutationRequest(_request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const forwardedProto = _request.headers.get("x-forwarded-proto");
  const protocol = (forwardedProto ? forwardedProto.split(",")[0].trim() : _request.nextUrl.protocol)
    .replace(":", "");
  const isRequestSecure = protocol === "https";

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: getAuthCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookie(isRequestSecure),
    path: "/",
    maxAge: 0,
  });

  return response;
}
