import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { listGoogleDriveFolder } from "@/lib/integrations/google-drive";

export const GET = withAuth("integrations:read", async (request: NextRequest, { auth }) => {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId") ?? "root";
  try {
    const entries = await listGoogleDriveFolder(auth.userId, folderId);
    return NextResponse.json({
      folderId,
      entries: entries.map((e) => ({
        id: e.id,
        name: e.name,
        mimeType: e.mimeType,
        kind: e.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
        size: e.size ? Number(e.size) : 0,
        modified: e.modifiedTime ?? null,
      })),
    });
  } catch (err) {
    throw new ApiRouteError((err as Error).message, 502);
  }
});
