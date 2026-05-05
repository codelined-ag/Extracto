import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
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

export const GET = withAuth<{ provider: string }>(
  "integrations:read",
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

export const PUT = withMutationAuth<{ provider: string }>(
  "integrations:write",
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

export const DELETE = withMutationAuth<{ provider: string }>(
  "integrations:write",
  async (_request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isIntegrationProvider(provider)) throw new ApiRouteError("Unknown provider", 400);
    const removed = await deleteAppCredentials(auth.userId, provider);
    return NextResponse.json({ provider, removed });
  },
);
