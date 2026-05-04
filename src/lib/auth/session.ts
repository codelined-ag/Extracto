import { db } from "@/lib/db";
import { verifySessionToken, type AuthSessionPayload } from "@/lib/auth/token";

export async function verifyActiveSession(
  token: string | null | undefined,
): Promise<AuthSessionPayload | null> {
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  if (typeof payload.pv === "number") {
    const user = await db.authUser.findUnique({
      where: { id: payload.userId },
      select: { passwordChangedAt: true },
    });
    if (!user || user.passwordChangedAt.getTime() > payload.pv) {
      return null;
    }
  }

  return payload;
}
