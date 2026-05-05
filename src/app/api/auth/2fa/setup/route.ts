import { NextRequest, NextResponse } from "next/server";

import { handleApiError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { generateTotpEnrollment, hashRecoveryCodes } from "@/lib/auth/totp";

interface SetupBody extends Record<string, unknown> {
  force?: unknown;
}

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  try {
    const body = await parseJsonBody<SetupBody>(request).catch(() => ({}) as SetupBody);
    const force = body.force === true;
    const user = await db.authUser.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true, totpEnabled: true, totpSecret: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (user.totpEnabled) {
      return NextResponse.json(
        { error: "Two-factor authentication is already enabled. Disable it first to re-enroll." },
        { status: 409 },
      );
    }
    if (user.totpSecret && !force) {
      return NextResponse.json(
        {
          error:
            "An enrollment is already in progress. Verify the existing code, or call setup again with { force: true } to start over.",
        },
        { status: 409 },
      );
    }
    const enrollment = await generateTotpEnrollment(user);
    const recoveryRecords = hashRecoveryCodes(enrollment.recoveryCodes);
    await db.authUser.update({
      where: { id: user.id },
      data: {
        totpSecret: enrollment.secret,
        totpEnabled: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        totpRecoveryCodesHash: recoveryRecords as any,
      },
    });
    return NextResponse.json({
      otpauthUrl: enrollment.otpauthUrl,
      qrPngDataUrl: enrollment.qrPngDataUrl,
      recoveryCodes: enrollment.recoveryCodes,
    });
  } catch (error) {
    return handleApiError(error);
  }
});
