import { normalizeProvider, type ApiProviderSettings, type ProviderKind } from "@/lib/api-types";
import { db } from "@/lib/db";
import { resolveMistralOcrModel } from "@/lib/ocr/providers/mistral";
import { buildPrompt, sanitizePostProcessing } from "@/lib/ocr/job-input-helpers";
import { getDocumentPreset } from "@/lib/ocr/document-presets";
import {
  DEFAULT_SETTINGS,
  OCR_SETTINGS_KEY,
  PAGE_CONCURRENCY_AUTO,
  defaultPageConcurrencyForProvider,
  normalizeAdvancedSettings,
  type AdvancedSettings,
  type PostProcessingSettings,
} from "@/lib/ocr/settings";
import { getApiSettings } from "@/lib/ocr/settings-store";

async function loadStoredAdvancedSettings(userId: string): Promise<AdvancedSettings> {
  try {
    const row = await db.ocrSetting.findUnique({
      where: { userId_key: { userId, key: OCR_SETTINGS_KEY } },
    });
    if (!row) return { ...DEFAULT_SETTINGS };
    return normalizeAdvancedSettings(row);
  } catch (error) {
    console.warn(
      `loadStoredAdvancedSettings(${userId}) failed: ${error instanceof Error ? error.message : String(error)}; falling back to DEFAULT_SETTINGS`,
    );
    return { ...DEFAULT_SETTINGS };
  }
}

export interface ResolvedJobInputs {
  provider: ProviderKind;
  ocrModel: string;
  prompt: string;
  settings: ApiProviderSettings;
  settingsPayload: AdvancedSettings;
  postProcessingPayload: PostProcessingSettings;
}

/**
 * Centralizes the four-line setup block that every job-submission entry
 * point used to inline: load stored provider settings, normalize the
 * provider, derive the OCR model (Mistral has a separate OCR-only
 * model), normalize per-request advanced settings + post-processing,
 * and build the per-page system prompt.
 *
 * Used by /api/ocr POST, /api/v1/ocr/batch, /api/v1/openai/chat/completions
 * and lib/background/watched-folder so all four sources construct the
 * same submitOcrJob arguments.
 */
export async function resolveOcrJobInputs(args: {
  userId: string;
  model: string;
  perRequestSettings?: Partial<AdvancedSettings>;
  perRequestPostProcessing?: Partial<PostProcessingSettings>;
  /** Optional pre-loaded settings (avoids the getApiSettings call when the caller already has them). */
  preloadedSettings?: ApiProviderSettings;
}): Promise<ResolvedJobInputs> {
  const stored = args.preloadedSettings ?? (await getApiSettings(args.userId));
  const provider = normalizeProvider(stored.provider);
  const settings: ApiProviderSettings = { ...stored, provider };

  const storedAdvanced = await loadStoredAdvancedSettings(args.userId);
  const merged = { ...storedAdvanced, ...(args.perRequestSettings ?? {}) };
  const normalized = normalizeAdvancedSettings(merged);
  const resolvedConcurrency =
    normalized.pageConcurrency === PAGE_CONCURRENCY_AUTO
      ? defaultPageConcurrencyForProvider(provider)
      : normalized.pageConcurrency;
  const settingsPayload = applyPresetForcedFlags({ ...normalized, pageConcurrency: resolvedConcurrency });
  const postProcessingPayload = sanitizePostProcessing(args.perRequestPostProcessing);
  const ocrModel = provider === "mistral" ? resolveMistralOcrModel(args.model) : args.model;
  const prompt = buildPrompt(settingsPayload);

  return { provider, ocrModel, prompt, settings, settingsPayload, postProcessingPayload };
}

function applyPresetForcedFlags(settings: AdvancedSettings): AdvancedSettings {
  const preset = getDocumentPreset(settings.documentPreset);
  return {
    ...settings,
    tableDetection: preset.forceTableDetection ?? settings.tableDetection,
    preserveFormatting: preset.forcePreserveFormatting ?? settings.preserveFormatting,
  };
}
