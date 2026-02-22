import { NextRequest } from "next/server";

import { getAuthCookieName, verifySessionToken } from "@/lib/auth/token";

export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(getAuthCookieName())?.value;
  const payload = await verifySessionToken(token);
  return payload?.userId ?? null;
}

