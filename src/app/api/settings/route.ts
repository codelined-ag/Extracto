import { NextRequest, NextResponse } from "next/server";

import { getApiSettings, saveApiSettings } from "@/lib/settings-store";

export async function GET() {
  const settings = await getApiSettings();
  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Partial<{
    provider: string;
    apiEndpoint: string;
    apiKey: string;
  }>;

  const updated = await saveApiSettings({
    provider: body.provider,
    apiEndpoint: body.apiEndpoint?.trim(),
    apiKey: body.apiKey?.trim(),
  });

  return NextResponse.json(updated);
}
