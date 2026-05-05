import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { deleteIntegrationConnection } from "@/lib/integrations/store";

export const DELETE = withMutationAuth("integrations:write", async (_request: NextRequest, { auth }) => {
  const ok = await deleteIntegrationConnection(auth.userId, "onedrive");
  if (!ok) throw new ApiRouteError("No OneDrive connection found", 404);
  return NextResponse.json({ disconnected: true });
});
