import { normalizeProvider, type ProviderKind } from "@/lib/ocr/endpoint-policy";
import { resolveMistralOcrModel } from "@/lib/ocr/providers/mistral";
import { buildPrompt, sanitizePostProcessing } from "@/lib/ocr/pipeline";
import {
  normalizeAdvancedSettings,
  type AdvancedSettings,
  type PostProcessingSettings,
} from "@/lib/ocr/settings";
import { getApiSettings, type ApiProviderSettings } from "@/lib/ocr/settings-store";

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

  const settingsPayload = normalizeAdvancedSettings(args.perRequestSettings);
  const postProcessingPayload = sanitizePostProcessing(args.perRequestPostProcessing);
  const ocrModel = provider === "mistral" ? resolveMistralOcrModel(args.model) : args.model;
  const prompt = buildPrompt(settingsPayload);

  return { provider, ocrModel, prompt, settings, settingsPayload, postProcessingPayload };
}
