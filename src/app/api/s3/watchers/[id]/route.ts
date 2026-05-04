import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const DELETE = withMutationAuth<{ id: string }>(
  "settings:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    const result = await db.watchedS3Source.deleteMany({ where: { id, userId: auth.userId } });
    if (result.count === 0) throw new ApiRouteError("Watcher not found", 404);
    return NextResponse.json({ deleted: true });
  },
);
