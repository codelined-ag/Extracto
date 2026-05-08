import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { withMutationAuth } from "@/lib/auth/request";
import { dispatchTestWebhook } from "@/lib/background/webhooks";
import { enforceWebhookTestRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";

export const POST = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Webhook id is required", 400);
    const limited = await enforceWebhookTestRateLimit(auth, getClientIpAddress(request));
    if (limited) return limited;
    const outcome = await dispatchTestWebhook(auth.userId, id);
    if (outcome.errorMessage === "Webhook not found") {
      throw new ApiRouteError("Webhook not found", 404);
    }
    return NextResponse.json(outcome);
  },
);
