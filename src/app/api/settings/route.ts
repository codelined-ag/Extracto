import { NextRequest, NextResponse } from "next/server";

import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
import { getApiSettings, saveApiSettings, toClientApiSettings } from "@/lib/settings-store";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scopeError = requireScope(auth, "settings:read");
  if (scopeError) return scopeError;
  const userId = auth.userId;

  try {
    const settings = await getApiSettings(userId);
    return NextResponse.json(toClientApiSettings(settings));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load settings",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const result = await authenticateMutation(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const scopeError = requireScope(result.auth, "settings:write");
  if (scopeError) return scopeError;
  const userId = result.auth.userId;

  const body = (await request.json().catch(() => ({}))) as Partial<{
    provider: string;
    apiEndpoint: string;
    apiKey: string;
    replaceApiKey: boolean;
  }>;

  try {
    const updated = await saveApiSettings(userId, {
      provider: body.provider,
      apiEndpoint: body.apiEndpoint?.trim(),
      apiKey: body.apiKey,
      replaceApiKey: body.replaceApiKey === true,
    });

    return NextResponse.json(toClientApiSettings(updated));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save settings",
      },
      { status: 400 }
    );
  }
}
