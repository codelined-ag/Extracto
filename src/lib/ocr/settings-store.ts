import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type ApiProviderSettings, type ClientApiSettings, type ProviderKind, normalizeProvider } from "@/lib/api-types";
import { enforceProviderEndpointPolicy } from "@/lib/ocr/endpoint-policy";
import {
  normalizeHostEndpoint,
  resolveOllamaHostEndpoint,
} from "@/lib/ocr/host-normalization";
import {
  DEFAULT_MISTRAL_API_URL,
  DEFAULT_OPENAI_COMPAT_API_URL,
  DEFAULT_OPENROUTER_API_URL,
  OLLAMA_DEFAULT_HOST,
} from "@/lib/ocr/provider-config";
import {
  normalizeMistralEndpoint as normalizeMistralEndpointBase,
  normalizeOllamaEndpoint as normalizeOllamaEndpointBase,
  normalizeOpenAICompatEndpoint as normalizeOpenAICompatEndpointBase,
  normalizeOpenRouterEndpoint as normalizeOpenRouterEndpointBase,
} from "@/lib/ocr/provider-normalization";

const DEFAULT_OLLAMA_HOST = normalizeHostEndpoint(
  process.env.OLLAMA_HOST || "",
  OLLAMA_DEFAULT_HOST
);
const DEFAULT_MISTRAL_OCR_ENDPOINT = normalizeHostEndpoint(
  process.env.MISTRAL_OCR_API_URL || "",
  DEFAULT_MISTRAL_API_URL
);
const DEFAULT_OPENROUTER_API_ENDPOINT = normalizeHostEndpoint(
  process.env.OPENROUTER_API_URL || "",
  DEFAULT_OPENROUTER_API_URL
);
const DEFAULT_OPENAI_COMPAT_API_ENDPOINT = normalizeHostEndpoint(
  process.env.OPENAI_COMPAT_API_URL || "",
  DEFAULT_OPENAI_COMPAT_API_URL
);
const SHOULD_PRESERVE_LOCALHOST =
  (process.env.APP_NETWORK_MODE || "bridge").trim().toLowerCase() === "host";
// Exported so ocr/route.ts and other modules can share the same resolved
// fallback host instead of recomputing it independently.
export const FALLBACK_OLLAMA_HOST = resolveOllamaHostEndpoint(
  DEFAULT_OLLAMA_HOST,
  OLLAMA_DEFAULT_HOST
);
const DATA_ROOT = (() => {
  const envDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!envDatabaseUrl?.startsWith("file:")) {
    return process.cwd();
  }

  const databaseFile = envDatabaseUrl.replace(/^file:/u, "");
  return path.dirname(databaseFile);
})();


export function normalizeMistralEndpoint(rawEndpoint?: string): string {
  return normalizeMistralEndpointBase(rawEndpoint || "", DEFAULT_MISTRAL_OCR_ENDPOINT);
}

function normalizeOllamaEndpoint(rawEndpoint?: string): string {
  return normalizeOllamaEndpointBase(rawEndpoint || "", FALLBACK_OLLAMA_HOST, SHOULD_PRESERVE_LOCALHOST);
}

function normalizeOpenRouterEndpoint(rawEndpoint?: string): string {
  return normalizeOpenRouterEndpointBase(rawEndpoint || "", DEFAULT_OPENROUTER_API_ENDPOINT);
}

function normalizeOpenAICompatEndpoint(rawEndpoint?: string): string {
  return normalizeOpenAICompatEndpointBase(rawEndpoint || "", DEFAULT_OPENAI_COMPAT_API_ENDPOINT);
}

const PROVIDER_DEFAULT_ENDPOINTS: Record<ProviderKind, string> = {
  mistral: DEFAULT_MISTRAL_OCR_ENDPOINT,
  openrouter: DEFAULT_OPENROUTER_API_ENDPOINT,
  openai_compat: DEFAULT_OPENAI_COMPAT_API_ENDPOINT,
  ollama: FALLBACK_OLLAMA_HOST,
};

function normalizeApiEndpoint(rawEndpoint: string | undefined, provider: ProviderKind): string {
  if (provider === "mistral") return normalizeMistralEndpoint(rawEndpoint);
  if (provider === "openrouter") return normalizeOpenRouterEndpoint(rawEndpoint);
  if (provider === "openai_compat") return normalizeOpenAICompatEndpoint(rawEndpoint);
  return normalizeOllamaEndpoint(rawEndpoint);
}

export type { ApiProviderSettings, ClientApiSettings } from "@/lib/api-types";

interface SaveApiSettingsInput extends Omit<Partial<ApiProviderSettings>, "provider"> {
  provider?: string;
  replaceApiKey?: boolean;
}

const DEFAULT_API_SETTINGS: ApiProviderSettings = {
  provider: "ollama",
  apiEndpoint: normalizeApiEndpoint(DEFAULT_OLLAMA_HOST, "ollama"),
  apiKey: "",
};

const SETTINGS_DIR = path.join(DATA_ROOT, "api-settings");
const settingsCache = new Map<string, ApiProviderSettings>();

const normalizeSettings = (settings: Partial<ApiProviderSettings>): ApiProviderSettings => {
  const provider = normalizeProvider(settings.provider);
  const normalizedEndpoint = normalizeApiEndpoint(settings.apiEndpoint, provider);
  const safeEndpoint = enforceProviderEndpointPolicy(
    provider,
    normalizedEndpoint,
    PROVIDER_DEFAULT_ENDPOINTS[provider]
  );

  return {
    provider,
    apiEndpoint: safeEndpoint,
    apiKey: settings.apiKey?.trim() || "",
  };
};

function sanitizeUserId(userId: string): string {
  return userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getSettingsPath(userId: string): string {
  return path.join(SETTINGS_DIR, `${sanitizeUserId(userId)}.json`);
}


export function toClientApiSettings(settings: ApiProviderSettings): ClientApiSettings {
  return {
    provider: settings.provider,
    apiEndpoint: settings.apiEndpoint,
    apiKey: "",
    hasApiKey: Boolean(settings.apiKey.trim()),
  };
}

export async function getApiSettings(userId: string): Promise<ApiProviderSettings> {
  const safeUserId = sanitizeUserId(userId);
  const cached = settingsCache.get(safeUserId);
  if (cached) {
    return { ...cached };
  }

  const settingsPath = getSettingsPath(safeUserId);
  try {
    const stored = await readFile(settingsPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error(`Settings file is corrupt: ${settingsPath}`);
    }
    try {
      // Falls back to defaults intentionally — policy violations and unknown providers are
      // self-healing for forward-compatibility. Corrupt JSON (above) throws so operators
      // notice file-level problems; invalid-but-parseable settings degrade silently.
      const normalized = normalizeSettings(parsed as Partial<ApiProviderSettings>);
      settingsCache.set(safeUserId, normalized);
      return { ...normalized };
    } catch (normalizeErr) {
      console.error(`[settings-store] Settings invalid for user ${safeUserId}, resetting to defaults:`, normalizeErr);
    }
  } catch (readErr: unknown) {
    const code = (readErr as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw readErr;
    }
  }
  const normalized = normalizeSettings(DEFAULT_API_SETTINGS);
  settingsCache.set(safeUserId, normalized);
  return { ...normalized };
}

export async function saveApiSettings(
  userId: string,
  settings: SaveApiSettingsInput
): Promise<ApiProviderSettings> {
  const safeUserId = sanitizeUserId(userId);
  const current = await getApiSettings(safeUserId);
  const provider = normalizeProvider(settings.provider || current.provider);
  const apiEndpoint = typeof settings.apiEndpoint === "string"
    ? settings.apiEndpoint
    : provider === current.provider
      ? current.apiEndpoint
      : PROVIDER_DEFAULT_ENDPOINTS[provider];
  const normalized = normalizeSettings({
    ...current,
    ...settings,
    provider,
    apiEndpoint,
    apiKey: settings.replaceApiKey ? (settings.apiKey?.trim() || "") : current.apiKey,
  });
  const settingsPath = getSettingsPath(safeUserId);
  await ensureSettingsDirectory();
  await writeFile(settingsPath, JSON.stringify(normalized, null, 2), "utf8");
  settingsCache.set(safeUserId, normalized);
  return { ...normalized };
}

async function ensureSettingsDirectory() {
  await mkdir(SETTINGS_DIR, { recursive: true });
}
