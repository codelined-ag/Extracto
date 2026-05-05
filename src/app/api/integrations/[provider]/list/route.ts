import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { isCloudProvider, listCloudFolder } from "@/lib/integrations/dispatch";

export const GET = withSessionAuth<{ provider: string }>(
  "read",
  "Integration list",
  async (request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isCloudProvider(provider)) throw new ApiRouteError("Unknown provider", 400);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    try {
      const entries = await listCloudFolder(provider, auth.userId, path);
      return NextResponse.json({ provider, path, entries });
    } catch (err) {
      throw new ApiRouteError((err as Error).message, 502);
    }
  },
);
