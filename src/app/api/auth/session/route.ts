import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getAuthCookieName, verifySessionToken } from "@/lib/auth/token";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(getAuthCookieName())?.value;
  const payload = await verifySessionToken(token);

  if (!payload) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const user = await db.authUser.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user,
  });
}
