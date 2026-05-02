import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, handleApiError, parseJsonBody } from "@/lib/api-error";
import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
import { getApiSettings, saveApiSettings, toClientApiSettings } from "@/lib/settings-store";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const scopeError = requireScope(auth, "settings:read");
    if (scopeError) return scopeError;
    const userId = auth.userId;

    const settings = await getApiSettings(userId);
    return NextResponse.json(toClientApiSettings(settings));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await authenticateMutation(request);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const scopeError = requireScope(result.auth, "settings:write");
    if (scopeError) return scopeError;
    const userId = result.auth.userId;

    const body = await parseJsonBody<{
      provider: string;
      apiEndpoint: string;
      apiKey: string;
      replaceApiKey: boolean;
    }>(request);

    try {
      const updated = await saveApiSettings(userId, {
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
  } catch (error) {
    return handleApiError(error);
  }
}
