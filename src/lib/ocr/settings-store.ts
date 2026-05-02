import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type ApiProviderSettings, type ClientApiSettings, type ProviderKind, normalizeProvider } from "@/lib/api-types";
import { enforceProviderEndpointPolicy } from "@/lib/ocr/endpoint-policy";
import {
  normalizeHostEndpoint,
  resolveOllamaHostEndpoint,
} from "@/lib/ocr/host-normalization";
import {
  getDefaultMistralApiUrl,
  getDefaultOpenAICompatApiUrl,
  getDefaultOpenRouterApiUrl,
  OLLAMA_DEFAULT_HOST,
} from "@/lib/ocr/provider-config";
import {
  normalizeMistralEndpoint as normalizeMistralEndpointBase,
  normalizeOllamaEndpoint as normalizeOllamaEndpointBase,
  normalizeOpenAICompatEndpoint as normalizeOpenAICompatEndpointBase,
  normalizeOpenRouterEndpoint as normalizeOpenRouterEndpointBase,
} from "@/lib/ocr/provider-normalization";

// Lazy env-derived getters — match the pattern in lib/ocr/result-store.ts +
// lib/ocr/provider-config.ts. Tests can vi.stubEnv() without resetModules.

function getDefaultOllamaHost(): string {
  return normalizeHostEndpoint(process.env.OLLAMA_HOST || "", OLLAMA_DEFAULT_HOST);
}

function getDefaultMistralOcrEndpoint(): string {
  return normalizeHostEndpoint(process.env.MISTRAL_OCR_API_URL || "", getDefaultMistralApiUrl());
}

function getDefaultOpenRouterApiEndpoint(): string {
  return normalizeHostEndpoint(process.env.OPENROUTER_API_URL || "", getDefaultOpenRouterApiUrl());
}

function getDefaultOpenAICompatApiEndpoint(): string {
  return normalizeHostEndpoint(
    process.env.OPENAI_COMPAT_API_URL || "",
    getDefaultOpenAICompatApiUrl(),
  );
}

function shouldPreserveLocalhost(): boolean {
  return (process.env.APP_NETWORK_MODE || "bridge").trim().toLowerCase() === "host";
}

/**
 * Resolved Ollama fallback host. Returned fresh from env on each call so
 * tests + dynamic env changes are honored.
 */
export function getFallbackOllamaHost(): string {
  return resolveOllamaHostEndpoint(getDefaultOllamaHost(), OLLAMA_DEFAULT_HOST);
}

function getDataRoot(): string {
  const envDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!envDatabaseUrl?.startsWith("file:")) {
    return process.cwd();
  }
  const databaseFile = envDatabaseUrl.replace(/^file:/u, "");
  return path.dirname(databaseFile);
}


// Persistence-tier endpoint normalizers. Each binds the local
// "DEFAULT_*_ENDPOINT" derived from env, which differs from the runtime
// per-provider default URL — these run when reading/writing user-stored
// settings, not when issuing OCR requests.

export function normalizeMistralEndpointForStorage(rawEndpoint?: string): string {
  return normalizeMistralEndpointBase(rawEndpoint || "", getDefaultMistralOcrEndpoint());
}

function normalizeOllamaEndpointForStorage(rawEndpoint?: string): string {
  return normalizeOllamaEndpointBase(rawEndpoint || "", getFallbackOllamaHost(), shouldPreserveLocalhost());
}

function normalizeOpenRouterEndpointForStorage(rawEndpoint?: string): string {
  return normalizeOpenRouterEndpointBase(rawEndpoint || "", getDefaultOpenRouterApiEndpoint());
}

function normalizeOpenAICompatEndpointForStorage(rawEndpoint?: string): string {
  return normalizeOpenAICompatEndpointBase(rawEndpoint || "", getDefaultOpenAICompatApiEndpoint());
}

function getProviderDefaultEndpoints(): Record<ProviderKind, string> {
  return {
    mistral: getDefaultMistralOcrEndpoint(),
    openrouter: getDefaultOpenRouterApiEndpoint(),
    openai_compat: getDefaultOpenAICompatApiEndpoint(),
    ollama: getFallbackOllamaHost(),
  };
}

function normalizeApiEndpoint(rawEndpoint: string | undefined, provider: ProviderKind): string {
  if (provider === "mistral") return normalizeMistralEndpointForStorage(rawEndpoint);
  if (provider === "openrouter") return normalizeOpenRouterEndpointForStorage(rawEndpoint);
  if (provider === "openai_compat") return normalizeOpenAICompatEndpointForStorage(rawEndpoint);
  return normalizeOllamaEndpointForStorage(rawEndpoint);
}

export type { ApiProviderSettings, ClientApiSettings } from "@/lib/api-types";

interface SaveApiSettingsInput extends Omit<Partial<ApiProviderSettings>, "provider"> {
  provider?: string;
  replaceApiKey?: boolean;
}

function getDefaultApiSettings(): ApiProviderSettings {
  return {
    provider: "ollama",
    apiEndpoint: normalizeApiEndpoint(getDefaultOllamaHost(), "ollama"),
    apiKey: "",
  };
}

function getSettingsDir(): string { return path.join(getDataRoot(), "api-settings"); }
const settingsCache = new Map<string, ApiProviderSettings>();

const normalizeSettings = (settings: Partial<ApiProviderSettings>): ApiProviderSettings => {
  const provider = normalizeProvider(settings.provider);
  const normalizedEndpoint = normalizeApiEndpoint(settings.apiEndpoint, provider);
  const safeEndpoint = enforceProviderEndpointPolicy(
    provider,
    normalizedEndpoint,
    getProviderDefaultEndpoints()[provider]
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
  return path.join(getSettingsDir(), `${sanitizeUserId(userId)}.json`);
}


export function toClientApiSettings(settings: ApiProviderSettings): ClientApiSettings {
  return {
    provider: settings.provider,
    apiEndpoint: settings.apiEndpoint,
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
  const normalized = normalizeSettings(getDefaultApiSettings());
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
      : getProviderDefaultEndpoints()[provider];
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
  await mkdir(getSettingsDir(), { recursive: true });
}
