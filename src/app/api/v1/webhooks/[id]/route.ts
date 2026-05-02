import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const DELETE = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Webhook id is required" }, { status: 400 });
    }

    const deleted = await db.webhook.deleteMany({ where: { id, userId: auth.userId } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: deleted.count });
  },
);

export const PATCH = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Webhook id is required" }, { status: 400 });
    }

    const body = await parseJsonBody<{ active?: unknown }>(request);
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active (boolean) is required" }, { status: 400 });
    }

    const updated = await db.webhook.updateMany({
      where: { id, userId: auth.userId },
      data: { active: body.active },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }
    return NextResponse.json({ updated: updated.count });
  },
);
