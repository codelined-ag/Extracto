import type { ApiProviderSettings, ProviderKind } from "@/lib/api-types";
import {
  decorateOllamaErrors,
  getOllamaCandidatesForOcr,
} from "@/lib/ocr/ollama-dispatch";
import {
  OPENAI_COMPAT_CONFIG,
  OPENROUTER_CONFIG,
  runCompatOcr,
  runCompatPostProcessing,
} from "@/lib/ocr/providers/compat";
import {
  runMistralOcr,
  runMistralPostProcessing,
} from "@/lib/ocr/providers/mistral";
import {
  runOllamaOcr,
  runOllamaPostProcessing,
} from "@/lib/ocr/providers/ollama";
import type { OcrRunResult, PostProcessResult } from "@/lib/ocr/providers/shared";
import type { PostProcessOutputFormat } from "@/lib/ocr/settings";

interface ProviderHandler {
  envKey: string | null;
  runOcr: (
    settings: ApiProviderSettings,
    model: string,
    prompt: string,
    preview: string,
    apiKey: string,
    signal?: AbortSignal,
  ) => Promise<OcrRunResult>;
  runPostProcess: (
    settings: ApiProviderSettings,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    outputFormat: PostProcessOutputFormat,
    signal?: AbortSignal,
  ) => Promise<PostProcessResult>;
}

const PROVIDER_HANDLERS: Record<ProviderKind, ProviderHandler> = {
  ollama: {
    envKey: null,
    runOcr: (s, m, p, pv, _k, sig) =>
      decorateOllamaErrors(s.apiEndpoint, () =>
        runOllamaOcr(getOllamaCandidatesForOcr(s.apiEndpoint), m, p, pv, sig),
      ),
    runPostProcess: (s, m, sp, up, _k, of, sig) =>
      decorateOllamaErrors(s.apiEndpoint, () =>
        runOllamaPostProcessing(getOllamaCandidatesForOcr(s.apiEndpoint), m, sp, up, of, sig),
      ),
  },
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    runOcr: (s, m, p, pv, k, sig) =>
      runCompatOcr(OPENROUTER_CONFIG, s.apiEndpoint, m, k, p, pv, sig),
    runPostProcess: (s, m, sp, up, k, of, sig) =>
      runCompatPostProcessing(OPENROUTER_CONFIG, s.apiEndpoint, m, k, sp, up, of, sig),
  },
  openai_compat: {
    envKey: "OPENAI_COMPAT_API_KEY",
    runOcr: (s, m, p, pv, k, sig) =>
      runCompatOcr(OPENAI_COMPAT_CONFIG, s.apiEndpoint, m, k, p, pv, sig),
    runPostProcess: (s, m, sp, up, k, of, sig) =>
      runCompatPostProcessing(OPENAI_COMPAT_CONFIG, s.apiEndpoint, m, k, sp, up, of, sig),
  },
  mistral: {
    envKey: "MISTRAL_API_KEY",
    runOcr: (s, m, _p, pv, k, sig) => runMistralOcr(s.apiEndpoint, m, k, pv, sig),
    runPostProcess: (s, m, sp, up, k, of, sig) =>
      runMistralPostProcessing(s.apiEndpoint, m, k, sp, up, of, sig),
  },
};

function resolveProviderApiKey(provider: ProviderKind, settings: ApiProviderSettings): string {
  if (settings.apiKey) return settings.apiKey;
  const envKey = PROVIDER_HANDLERS[provider].envKey;
  return envKey ? (process.env[envKey] || "") : "";
}

export async function runProviderOcr(
  provider: ProviderKind,
  settings: ApiProviderSettings,
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal,
): Promise<OcrRunResult> {
  const handler = PROVIDER_HANDLERS[provider];
  return handler.runOcr(settings, model, prompt, preview, resolveProviderApiKey(provider, settings), signal);
}

export async function runProviderPostProcessing(
  provider: ProviderKind,
  settings: ApiProviderSettings,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat,
  signal?: AbortSignal,
): Promise<PostProcessResult> {
  const handler = PROVIDER_HANDLERS[provider];
  return handler.runPostProcess(
    settings,
    model,
    systemPrompt,
    userPrompt,
    resolveProviderApiKey(provider, settings),
    outputFormat,
    signal,
  );
}
