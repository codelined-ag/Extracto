import { NextResponse, type NextRequest } from "next/server";

import { withSessionAuth } from "@/lib/auth/request";
import { listIntegrationConnections } from "@/lib/integrations/store";
import {
  readDropboxAppCredentials,
  readGoogleDriveAppCredentials,
  readOneDriveAppCredentials,
} from "@/lib/integrations/types";

export const GET = withSessionAuth("read", "Integrations", async (_request: NextRequest, { auth }) => {
  const connections = await listIntegrationConnections(auth.userId);
  return NextResponse.json({
    available: {
      dropbox: Boolean(readDropboxAppCredentials()),
      google_drive: Boolean(readGoogleDriveAppCredentials()),
      onedrive: Boolean(readOneDriveAppCredentials()),
    },
    connections,
  });
});
