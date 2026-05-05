import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { deleteIntegrationConnection } from "@/lib/integrations/store";

export const DELETE = withSessionAuth("mutation", "Dropbox connection", async (_request: NextRequest, { auth }) => {
  const ok = await deleteIntegrationConnection(auth.userId, "dropbox");
  if (!ok) throw new ApiRouteError("No Dropbox connection found", 404);
  return NextResponse.json({ disconnected: true });
});
