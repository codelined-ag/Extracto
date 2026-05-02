import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { getApiSettings, saveApiSettings, toClientApiSettings } from "@/lib/settings-store";

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const settings = await getApiSettings(auth.userId);
  return NextResponse.json(toClientApiSettings(settings));
});

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<{
    provider: string;
    apiEndpoint: string;
    apiKey: string;
    replaceApiKey: boolean;
  }>(request);

  try {
    const updated = await saveApiSettings(auth.userId, {
      provider: body.provider,
      apiEndpoint: body.apiEndpoint?.trim(),
      apiKey: body.apiKey,
      replaceApiKey: body.replaceApiKey === true,
    });
    return NextResponse.json(toClientApiSettings(updated));
  } catch (saveErr) {
    // Save validation errors are 400 (user input), not 500 (server fault).
    throw new ApiRouteError(
      saveErr instanceof Error ? saveErr.message : "Unable to save settings",
      400
    );
  }
});
