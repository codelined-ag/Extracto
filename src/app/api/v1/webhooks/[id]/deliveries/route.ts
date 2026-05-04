import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const GET = withAuth<{ id: string }>(
  "webhooks:read",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    const webhook = await db.webhook.findFirst({
      where: { id, userId: auth.userId },
      select: { id: true },
    });
    if (!webhook) throw new ApiRouteError("Webhook not found", 404);

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(100, Math.trunc(limitRaw)) : 20;

    const deliveries = await db.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { attemptedAt: "desc" },
      take: limit,
    });
    return NextResponse.json({ deliveries });
  },
);
