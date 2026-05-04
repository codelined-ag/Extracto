import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import {
  getS3Defaults,
  saveS3Defaults,
  toClientS3Defaults,
  type SaveS3DefaultsInput,
} from "@/lib/s3/defaults-store";

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const defaults = await getS3Defaults(auth.userId);
  return NextResponse.json(toClientS3Defaults(defaults));
});

export const PUT = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<SaveS3DefaultsInput>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiRouteError("Invalid JSON payload", 400);
  }
  const saved = await saveS3Defaults(auth.userId, body);
  return NextResponse.json(toClientS3Defaults(saved));
});
