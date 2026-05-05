import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { listOneDriveFolder } from "@/lib/integrations/onedrive";

export const GET = withAuth("ocr:read", async (request: NextRequest, { auth }) => {
  const url = new URL(request.url);
  const folderId = (url.searchParams.get("folderId") ?? "").trim();
  try {
    const entries = await listOneDriveFolder(auth.userId, folderId);
    return NextResponse.json({
      folderId,
      entries: entries.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.folder ? "folder" : "file",
        mimeType: e.file?.mimeType ?? null,
        size: e.size ?? 0,
        modified: e.lastModifiedDateTime ?? null,
      })),
    });
  } catch (err) {
    throw new ApiRouteError((err as Error).message, 502);
  }
});
