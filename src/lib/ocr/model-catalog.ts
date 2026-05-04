import type { ApiProviderSettings, ProviderKind } from "@/lib/api-types";
import { getOllamaModels } from "@/lib/ocr/ollama-dispatch";
import {
  getDefaultOpenAICompatApiUrl,
  getDefaultOpenAICompatFallbackModels,
  getDefaultOpenRouterApiUrl,
  getDefaultOpenRouterFallbackModels,
} from "@/lib/ocr/provider-config";
import {
  discoverCompatModels,
  OPENAI_COMPAT_CONFIG,
  OPENROUTER_CONFIG,
} from "@/lib/ocr/providers/compat";
import { listMistralModels } from "@/lib/ocr/providers/mistral";

export interface ModelCatalog {
  ollama: string[];
  mistral: string[];
  openrouter: string[];
  openai_compat: string[];
}

interface ModelCatalogOptions {
  provider?: ProviderKind;
}

async function discoverModelsOrEmpty(discover: () => Promise<string[]>, label: string): Promise<string[]> {
  try {
    return await discover();
  } catch (error) {
    console.error(`Failed to fetch ${label}:`, error);
    return [];
  }
}

function emptyCatalog(): ModelCatalog {
  return { ollama: [], mistral: [], openrouter: [], openai_compat: [] };
}

export async function getModelCatalog(
  settings: ApiProviderSettings,
  options: ModelCatalogOptions = {},
): Promise<ModelCatalog> {
  const provider = options.provider;
  const catalog = emptyCatalog();

  if (!provider || provider === "mistral") {
    catalog.mistral = listMistralModels();
  }

  if (!provider || provider === "ollama") {
    catalog.ollama = await discoverModelsOrEmpty(
      () => getOllamaModels(settings.apiEndpoint).then((r) => r.models),
      "Ollama model catalog",
    );
  }

  const openRouterEndpoint =
    settings.provider === "openrouter" ? settings.apiEndpoint : getDefaultOpenRouterApiUrl();
  const openRouterKey =
    settings.provider === "openrouter"
      ? settings.apiKey || process.env.OPENROUTER_API_KEY || ""
      : process.env.OPENROUTER_API_KEY || "";
  if (!provider || provider === "openrouter") {
    const openRouterModels = openRouterKey
      ? await discoverModelsOrEmpty(
          () => discoverCompatModels(OPENROUTER_CONFIG, openRouterEndpoint, openRouterKey),
          "OpenRouter model catalog",
        )
      : [];
    catalog.openrouter =
      openRouterModels.length === 0 && settings.provider === "openrouter"
        ? [...getDefaultOpenRouterFallbackModels()]
        : openRouterModels;
  }

  const openAICompatEndpoint =
    settings.provider === "openai_compat" ? settings.apiEndpoint : getDefaultOpenAICompatApiUrl();
  const openAICompatKey =
    settings.provider === "openai_compat"
      ? settings.apiKey || process.env.OPENAI_COMPAT_API_KEY || ""
      : process.env.OPENAI_COMPAT_API_KEY || "";
  if (!provider || provider === "openai_compat") {
    const openAICompatModels = openAICompatKey
      ? await discoverModelsOrEmpty(
          () => discoverCompatModels(OPENAI_COMPAT_CONFIG, openAICompatEndpoint, openAICompatKey),
          "OpenAI-compatible model catalog",
        )
      : [];
    catalog.openai_compat =
      openAICompatModels.length === 0 && settings.provider === "openai_compat"
        ? [...getDefaultOpenAICompatFallbackModels()]
        : openAICompatModels;
  }

  return catalog;
}
