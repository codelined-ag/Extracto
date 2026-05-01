import { NextRequest, NextResponse } from "next/server";
import { OcrSetting } from "@prisma/client";
import { db } from "@/lib/db";
import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
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

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scopeError = requireScope(auth, "settings:read");
  if (scopeError) return scopeError;

  const settings = await getDefaultSettingsRow();
  return NextResponse.json(mapSettingsResponse(settings));
}

export async function PUT(request: NextRequest) {
  const result = await authenticateMutation(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const scopeError = requireScope(result.auth, "settings:write");
  if (scopeError) return scopeError;

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
