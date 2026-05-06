import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { verifyStoredTotpCode } from "@/lib/auth/totp";

interface VerifyBody extends Record<string, unknown> {
  code?: unknown;
}

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  try {
    const body = await parseJsonBody<VerifyBody>(request);
    const code = typeof body.code === "string" ? body.code : "";
    if (!code) throw new ApiRouteError("code is required", 400);
    const user = await db.authUser.findUnique({
      where: { id: auth.userId },
      select: { id: true, totpSecret: true, totpEnabled: true },
    });
    if (!user || !user.totpSecret) {
      throw new ApiRouteError("No 2FA setup in progress. Run setup first.", 409);
    }
    if (!verifyStoredTotpCode(user.totpSecret, code)) {
      throw new ApiRouteError("Invalid verification code", 400);
    }
    if (!user.totpEnabled) {
      await db.authUser.update({
        where: { id: user.id },
        data: { totpEnabled: true },
      });
    }
    return NextResponse.json({ totpEnabled: true });
  } catch (error) {
    return handleApiError(error);
  }
});
