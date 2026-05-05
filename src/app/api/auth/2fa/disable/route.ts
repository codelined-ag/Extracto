import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/credentials";
import { verifyTotpForUser } from "@/lib/auth/totp";

interface DisableBody extends Record<string, unknown> {
  password?: unknown;
  code?: unknown;
}

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  try {
    const body = await parseJsonBody<DisableBody>(request);
    const password = typeof body.password === "string" ? body.password : "";
    const code = typeof body.code === "string" ? body.code : "";
    if (!password || !code) {
      throw new ApiRouteError("password and code are required", 400);
    }
    const user = await db.authUser.findUnique({
      where: { id: auth.userId },
      select: { id: true, passwordHash: true, totpEnabled: true },
    });
    if (!user) throw new ApiRouteError("User not found", 404);
    if (!user.totpEnabled) {
      return NextResponse.json({ totpEnabled: false });
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new ApiRouteError("Invalid password", 401);
    }
    const verified = await verifyTotpForUser(user.id, code);
    if (!verified) {
      throw new ApiRouteError("Invalid verification code", 401);
    }
    await db.authUser.update({
      where: { id: user.id },
      data: {
        totpEnabled: false,
        totpSecret: null,
        totpRecoveryCodesHash: Prisma.JsonNull,
      },
    });
    return NextResponse.json({ totpEnabled: false });
  } catch (error) {
    return handleApiError(error);
  }
});
