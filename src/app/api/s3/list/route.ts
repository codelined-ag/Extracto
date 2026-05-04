import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth } from "@/lib/auth/request";
import { enforceS3RateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import { listS3Objects } from "@/lib/s3/list";

export const GET = withAuth("s3:read", async (request: NextRequest, { auth }) => {
  const limited = await enforceS3RateLimit(auth, getClientIpAddress(request), "read");
  if (limited) return limited;
  const { searchParams } = new URL(request.url);
  const subPrefix = searchParams.get("prefix") ?? undefined;
  const continuationToken = searchParams.get("token") ?? undefined;
  const pageSizeRaw = Number(searchParams.get("pageSize") ?? "");
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? pageSizeRaw : undefined;
  const filterOcrExtensions = searchParams.get("all") === "1" ? false : true;

  try {
    const result = await listS3Objects(auth.userId, {
      subPrefix,
      pageSize,
      continuationToken,
      filterOcrExtensions,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error) {
      throw new ApiRouteError(err.message, /not configured/i.test(err.message) ? 400 : 502);
    }
    throw err;
  }
});
