import { NextRequest, NextResponse } from "next/server";

import { getAuthCookieName, shouldUseSecureCookie } from "@/lib/auth/token";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { isRequestSecure as checkRequestSecure } from "@/app/api/auth/helpers";

export function POST(_request: NextRequest) {
  if (!isTrustedMutationRequest(_request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const isRequestSecure = checkRequestSecure(_request);

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
