import { NextRequest, NextResponse } from "next/server";

import { withSessionAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const DELETE = withSessionAuth<{ id: string }>(
  "mutation",
  "API keys",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Key id is required" }, { status: 400 });
    }

    const updated = await db.apiKey.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ revoked: updated.count });
  },
);
