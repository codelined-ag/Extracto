import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { downloadS3Object } from "@/lib/s3/list";

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export const GET = withAuth("s3:read", async (request: NextRequest, { auth }) => {
  const { searchParams } = new URL(request.url);
  const key = (searchParams.get("key") ?? "").trim();
  if (!key) throw new ApiRouteError("key (string) is required", 400);
  if (key.length > 1024) throw new ApiRouteError("key is too long", 400);

  try {
    const obj = await downloadS3Object(auth.userId, key);
    if (obj.size > MAX_DOWNLOAD_BYTES) {
      throw new ApiRouteError(`Object is too large (${obj.size} bytes; max ${MAX_DOWNLOAD_BYTES})`, 413);
    }
    const fileName = key.split("/").pop() || "download";
    return new NextResponse(new Uint8Array(obj.body), {
      status: 200,
      headers: {
        "Content-Type": obj.contentType,
        "Content-Length": String(obj.size),
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]+/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ApiRouteError) throw err;
    if (err instanceof Error) {
      throw new ApiRouteError(err.message, /not configured/i.test(err.message) ? 400 : 502);
    }
    throw err;
  }
});
