import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, errorMessage, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { getApiSettings, saveApiSettings, toClientApiSettings } from "@/lib/ocr/settings-store";

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const settings = await getApiSettings(auth.userId);
  return NextResponse.json(toClientApiSettings(settings));
});

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<{
    provider?: unknown;
    apiEndpoint?: unknown;
    apiKey?: unknown;
    replaceApiKey?: unknown;
  }>(request);

  try {
    const updated = await saveApiSettings(auth.userId, {
      provider: typeof body.provider === "string" ? body.provider : "",
      apiEndpoint: typeof body.apiEndpoint === "string" ? body.apiEndpoint.trim() : "",
      apiKey: typeof body.apiKey === "string" ? body.apiKey : "",
      replaceApiKey: body.replaceApiKey === true,
    });
    return NextResponse.json(toClientApiSettings(updated));
  } catch (saveErr) {
    // Save validation errors are 400 (user input), not 500 (server fault).
    throw new ApiRouteError(errorMessage(saveErr, "Unable to save settings"), 400);
  }
});
