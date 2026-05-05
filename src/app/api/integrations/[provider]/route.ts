import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { isCloudProvider } from "@/lib/integrations/dispatch";
import { deleteIntegrationConnection } from "@/lib/integrations/store";

export const DELETE = withSessionAuth<{ provider: string }>(
  "mutation",
  "Integration disconnect",
  async (_request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isCloudProvider(provider)) throw new ApiRouteError("Unknown provider", 400);
    const removed = await deleteIntegrationConnection(auth.userId, provider);
    return NextResponse.json({ provider, removed });
  },
);
