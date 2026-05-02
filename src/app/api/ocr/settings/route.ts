import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import {
  AdvancedSettings,
  DEFAULT_SETTINGS,
  OCR_SETTINGS_KEY,
  normalizeAdvancedSettings,
} from "@/lib/ocr/settings";

const mapSettingsResponse = (setting: AdvancedSettings) => ({
  language: setting.language,
  tableDetection: setting.tableDetection,
  handwritingRecognition: setting.handwritingRecognition,
  preserveFormatting: setting.preserveFormatting,
  customPrompt: setting.customPrompt,
  quality: setting.quality,
});

export const GET = withAuth("settings:read", async () => {
  const existing = await db.ocrSetting.findUnique({ where: { key: OCR_SETTINGS_KEY } });
  return NextResponse.json(mapSettingsResponse(existing ?? DEFAULT_SETTINGS));
});

export const PUT = withMutationAuth("settings:write", async (request: NextRequest) => {
  const body = await parseJsonBody(request);
  const normalized = normalizeAdvancedSettings(body);

  const settings = await db.ocrSetting.upsert({
    where: { key: OCR_SETTINGS_KEY },
    create: {
      key: OCR_SETTINGS_KEY,
      ...normalized,
    },
    update: {
      ...normalized,
    },
  });

  return NextResponse.json(mapSettingsResponse(settings));
});
