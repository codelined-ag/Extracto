import { NextRequest, NextResponse } from "next/server";

import { getAuthCookieName, shouldUseSecureCookie } from "@/lib/auth/token";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { isRequestSecure as checkRequestSecure } from "@/app/api/auth/helpers";

export async function POST(request: NextRequest) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    name: getAuthCookieName(),
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: shouldUseSecureCookie(checkRequestSecure(request)),
    path: "/",
    maxAge: 0,
  });
  return response;
}
