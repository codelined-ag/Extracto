import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
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


export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const scopeError = requireScope(auth, "settings:read");
    if (scopeError) return scopeError;

    const existing = await db.ocrSetting.findUnique({ where: { key: OCR_SETTINGS_KEY } });
    return NextResponse.json(mapSettingsResponse(existing ?? DEFAULT_SETTINGS));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
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
  } catch (error) {
    return handleApiError(error);
  }
}
