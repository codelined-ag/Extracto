import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import {
  encryptWebhookSecret,
  generateWebhookSecret,
} from "@/lib/background/webhooks";

export const POST = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Webhook id is required", 400);
    const secret = generateWebhookSecret();
    const updated = await db.webhook.updateMany({
      where: { id, userId: auth.userId },
      data: { secret: encryptWebhookSecret(secret) },
    });
    if (updated.count === 0) {
      throw new ApiRouteError("Webhook not found", 404);
    }
    return NextResponse.json({
      id,
      secret,
      warning: "Store this signing secret now. The previous secret has been revoked.",
    });
  },
);
