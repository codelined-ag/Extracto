import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  try {
    const user = await db.authUser.findUnique({
      where: { id: auth.userId },
      select: { totpEnabled: true, totpSecret: true, totpRecoveryCodesHash: true },
    });
    const remaining = Array.isArray(user?.totpRecoveryCodesHash)
      ? (user!.totpRecoveryCodesHash as Array<{ used?: boolean }>).filter((r) => !r?.used).length
      : 0;
    return NextResponse.json({
      totpEnabled: Boolean(user?.totpEnabled),
      hasPendingSecret: Boolean(user?.totpSecret) && !user?.totpEnabled,
      recoveryCodesRemaining: remaining,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
