import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  OCR_SETTINGS_KEY,
  normalizeAdvancedSettings,
} from "@/lib/ocr/settings";

const mapSettingsResponse = (
  setting: { language: string; tableDetection: boolean; handwritingRecognition: boolean; preserveFormatting: boolean; customPrompt: string; quality: number; preferTextLayer?: boolean | null; documentPreset?: string | null },
) => ({
  language: setting.language,
  tableDetection: setting.tableDetection,
  handwritingRecognition: setting.handwritingRecognition,
  preserveFormatting: setting.preserveFormatting,
  customPrompt: setting.customPrompt,
  quality: setting.quality,
  preferTextLayer:
    typeof setting.preferTextLayer === "boolean" ? setting.preferTextLayer : DEFAULT_SETTINGS.preferTextLayer,
  documentPreset:
    typeof setting.documentPreset === "string" ? setting.documentPreset : DEFAULT_SETTINGS.documentPreset,
});

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const existing = await db.ocrSetting.findUnique({
    where: { userId_key: { userId: auth.userId, key: OCR_SETTINGS_KEY } },
  });
  return NextResponse.json(mapSettingsResponse(existing ?? DEFAULT_SETTINGS));
});

export const PUT = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody(request);
  const normalized = normalizeAdvancedSettings(body);

  const settings = await db.ocrSetting.upsert({
    where: { userId_key: { userId: auth.userId, key: OCR_SETTINGS_KEY } },
    create: {
      userId: auth.userId,
      key: OCR_SETTINGS_KEY,
      ...normalized,
    },
    update: {
      ...normalized,
    },
  });

  return NextResponse.json(mapSettingsResponse(settings));
});
