import { NextRequest, NextResponse } from "next/server";
import { OcrSetting } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  OCR_SETTINGS_KEY,
  normalizeAdvancedSettings,
} from "@/lib/ocr/settings";

const mapSettingsResponse = (setting: OcrSetting) => ({
  language: setting.language,
  tableDetection: setting.tableDetection,
  handwritingRecognition: setting.handwritingRecognition,
  preserveFormatting: setting.preserveFormatting,
  customPrompt: setting.customPrompt,
  quality: setting.quality,
});

async function getDefaultSettingsRow() {
  const settings = await db.ocrSetting.findUnique({
    where: { key: OCR_SETTINGS_KEY },
  });

  if (!settings) {
    return await db.ocrSetting.create({
      data: {
        key: OCR_SETTINGS_KEY,
        ...DEFAULT_SETTINGS,
      },
    });
  }

  return settings;
}

export async function GET() {
  const settings = await getDefaultSettingsRow();
  return NextResponse.json(mapSettingsResponse(settings));
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
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
}
