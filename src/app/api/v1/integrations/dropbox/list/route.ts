import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { listDropboxFolder } from "@/lib/integrations/dropbox";

export const GET = withAuth("integrations:read", async (request: NextRequest, { auth }) => {
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  try {
    const entries = await listDropboxFolder(auth.userId, path);
    return NextResponse.json({
      path,
      entries: entries.map((e) => ({
        kind: e[".tag"],
        id: e.id,
        name: e.name,
        path: e.path_display ?? e.path_lower ?? "",
        size: e.size ?? 0,
        modified: e.server_modified ?? e.client_modified ?? null,
      })),
    });
  } catch (err) {
    throw new ApiRouteError((err as Error).message, 502);
  }
});
