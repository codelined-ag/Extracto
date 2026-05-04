import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { enforceS3RateLimit } from "@/lib/ocr/rate-limit";
import { openS3Download } from "@/lib/s3/list";
import { getClientIpAddress } from "@/lib/request-security";

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export const GET = withAuth("s3:read", async (request: NextRequest, { auth }) => {
  const limited = await enforceS3RateLimit(auth, getClientIpAddress(request), "read");
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const key = (searchParams.get("key") ?? "").trim();
  if (!key) throw new ApiRouteError("key (string) is required", 400);
  if (key.length > 1024) throw new ApiRouteError("key is too long", 400);

  try {
    const dl = await openS3Download(auth.userId, key, MAX_DOWNLOAD_BYTES);
    const fileName = key.split("/").pop() || "download";
    return new NextResponse(dl.stream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": dl.contentType,
        "Content-Length": String(dl.size),
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]+/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ApiRouteError) throw err;
    if (err && typeof err === "object" && "statusCode" in err) {
      const e = err as { message?: unknown; statusCode: number };
      throw new ApiRouteError(typeof e.message === "string" ? e.message : "S3 download failed", e.statusCode);
    }
    if (err instanceof Error) {
      const status = /not configured|invalid|outside|".."|control char/i.test(err.message) ? 400 : 502;
      throw new ApiRouteError(err.message, status);
    }
    throw err;
  }
});
