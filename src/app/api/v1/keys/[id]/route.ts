import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { withSessionAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const DELETE = withSessionAuth<{ id: string }>(
  "mutation",
  "API keys",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Key id is required", 400);
    }

    const updated = await db.apiKey.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (updated.count === 0) {
      throw new ApiRouteError("Key not found", 404);
    }

    return NextResponse.json({ revoked: updated.count });
  },
);
