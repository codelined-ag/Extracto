import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import {
  deleteAppCredentials,
  getAppCredentialStatus,
  setAppCredentials,
} from "@/lib/integrations/oauth-app-store";
import { getRedirectUri, isIntegrationProvider } from "@/lib/integrations/types";

interface PutBody extends Record<string, unknown> {
  clientId?: unknown;
  clientSecret?: unknown;
}

export const GET = withSessionAuth<{ provider: string }>(
  "read",
  "Integration OAuth app",
  async (_request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isIntegrationProvider(provider)) throw new ApiRouteError("Unknown provider", 400);
    const status = await getAppCredentialStatus(auth.userId, provider);
    return NextResponse.json({
      provider,
      source: status.source,
      clientIdLast4: status.clientIdLast4,
      redirectUri: getRedirectUri(provider),
    });
  },
);

export const PUT = withSessionAuth<{ provider: string }>(
  "mutation",
  "Integration OAuth app",
  async (request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isIntegrationProvider(provider)) throw new ApiRouteError("Unknown provider", 400);
    const body = await parseJsonBody<PutBody>(request);
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
    if (!clientId || clientId.length > 200) throw new ApiRouteError("clientId is required", 400);
    if (!clientSecret || clientSecret.length > 400) {
      throw new ApiRouteError("clientSecret is required", 400);
    }
    await setAppCredentials({ userId: auth.userId, provider, clientId, clientSecret });
    return NextResponse.json({ provider, source: "user", clientIdLast4: clientId.slice(-4) });
  },
);

export const DELETE = withSessionAuth<{ provider: string }>(
  "mutation",
  "Integration OAuth app",
  async (_request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isIntegrationProvider(provider)) throw new ApiRouteError("Unknown provider", 400);
    const removed = await deleteAppCredentials(auth.userId, provider);
    return NextResponse.json({ provider, removed });
  },
);
