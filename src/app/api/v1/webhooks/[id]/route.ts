import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const DELETE = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Webhook id is required", 400);
    }

    const deleted = await db.webhook.deleteMany({ where: { id, userId: auth.userId } });
    if (deleted.count === 0) {
      throw new ApiRouteError("Webhook not found", 404);
    }

    return NextResponse.json({ deleted: deleted.count });
  },
);

export const PATCH = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Webhook id is required", 400);
    }

    const body = await parseJsonBody<{ active?: unknown }>(request);
    if (typeof body.active !== "boolean") {
      throw new ApiRouteError("active (boolean) is required", 400);
    }

    const updated = await db.webhook.updateMany({
      where: { id, userId: auth.userId },
      data: { active: body.active },
    });
    if (updated.count === 0) {
      throw new ApiRouteError("Webhook not found", 404);
    }
    return NextResponse.json({ updated: updated.count });
  },
);
