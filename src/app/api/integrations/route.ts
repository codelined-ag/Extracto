import { NextResponse, type NextRequest } from "next/server";

import { withSessionAuth } from "@/lib/auth/request";
import { getAppCredentialStatus } from "@/lib/integrations/oauth-app-store";
import { listIntegrationConnections } from "@/lib/integrations/store";
import { INTEGRATION_PROVIDERS } from "@/lib/integrations/types";

export const GET = withSessionAuth("read", "Integrations", async (_request: NextRequest, { auth }) => {
  const [connections, ...statuses] = await Promise.all([
    listIntegrationConnections(auth.userId),
    ...INTEGRATION_PROVIDERS.map((p) => getAppCredentialStatus(auth.userId, p)),
  ]);
  const oauthApp: Record<string, { source: string; clientIdLast4: string | null }> = {};
  INTEGRATION_PROVIDERS.forEach((p, i) => {
    oauthApp[p] = statuses[i] as { source: string; clientIdLast4: string | null };
  });
  return NextResponse.json({
    available: {
      dropbox: oauthApp.dropbox.source !== "none",
      google_drive: oauthApp.google_drive.source !== "none",
      onedrive: oauthApp.onedrive.source !== "none",
    },
    oauthApp,
    connections,
  });
});
