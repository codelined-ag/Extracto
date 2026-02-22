import { NextRequest, NextResponse } from "next/server";

import { getAuthenticatedUserId } from "@/lib/auth/request";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { getApiSettings, saveApiSettings, toClientApiSettings } from "@/lib/settings-store";

export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Partial<{
    provider: string;
    apiEndpoint: string;
    apiKey: string;
    replaceApiKey: boolean;
    obsidianBaseDir: string;
  }>;

  try {
    const updated = await saveApiSettings(userId, {
      provider: body.provider,
      apiEndpoint: body.apiEndpoint?.trim(),
      apiKey: body.apiKey,
      replaceApiKey: body.replaceApiKey === true,
      obsidianBaseDir: body.obsidianBaseDir?.trim(),
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
