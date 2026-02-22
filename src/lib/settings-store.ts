import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { enforceProviderEndpointPolicy } from "@/lib/endpoint-policy";
import {
  isLikelyLocalhostEndpoint,
  normalizeHostEndpoint,
  resolveOllamaHostEndpoint,
} from "@/lib/host-normalization";

const DEFAULT_OLLAMA_HOST = normalizeHostEndpoint(
  process.env.OLLAMA_HOST || "",
  "http://localhost:11434"
);
const DEFAULT_MISTRAL_OCR_ENDPOINT = normalizeHostEndpoint(
  process.env.MISTRAL_OCR_API_URL || "",
  "https://api.mistral.ai/v1/ocr"
);
const SHOULD_PRESERVE_LOCALHOST =
  (process.env.APP_NETWORK_MODE || "bridge").trim().toLowerCase() === "host";
const DEFAULT_OBSIDIAN_BASE_DIR = (process.env.OBSIDIAN_EXPORT_BASE_DIR || "/host-vaults").trim();
const FALLBACK_OLLAMA_HOST = resolveOllamaHostEndpoint(
  DEFAULT_OLLAMA_HOST,
  "http://127.0.0.1:11434"
);
const DATA_ROOT = (() => {
  const envDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!envDatabaseUrl?.startsWith("file:")) {
    return process.cwd();
  }

  const databaseFile = envDatabaseUrl.replace(/^file:/u, "");
  return path.dirname(databaseFile);
})();

function normalizeProvider(rawProvider?: string): "ollama" | "mistral" {
  const provider = (rawProvider || "").trim().toLowerCase().split(":")[0];
  return provider === "mistral" ? "mistral" : "ollama";
}

function normalizeMistralEndpoint(rawEndpoint?: string): string {
  const normalized = normalizeHostEndpoint(rawEndpoint || "", DEFAULT_MISTRAL_OCR_ENDPOINT);

  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";

    const pathname = url.pathname.replace(/\/+$/u, "");
    if (pathname.endsWith("/v1/ocr")) {
      url.pathname = pathname;
      return url.toString();
    }
    if (pathname.endsWith("/v1/models")) {
      url.pathname = `${pathname.slice(0, -10)}/v1/ocr`;
      return url.toString();
    }
    if (pathname.endsWith("/models")) {
      const base = pathname.slice(0, -7);
      url.pathname = base.endsWith("/v1") ? `${base}/ocr` : `${base}/v1/ocr`;
      return url.toString();
    }
    if (pathname.endsWith("/ocr")) {
      const base = pathname.slice(0, -4);
      url.pathname = base.endsWith("/v1") ? `${base}/ocr` : `${base}/v1/ocr`;
      return url.toString();
    }
    if (pathname.endsWith("/v1")) {
      url.pathname = `${pathname}/ocr`;
      return url.toString();
    }
    if (!pathname || pathname === "/") {
      url.pathname = "/v1/ocr";
      return url.toString();
    }

    url.pathname = `${pathname}/v1/ocr`;
    return url.toString();
  } catch {
    return DEFAULT_MISTRAL_OCR_ENDPOINT;
  }
}

function normalizeOllamaEndpoint(rawEndpoint?: string): string {
  const configuredHost = FALLBACK_OLLAMA_HOST;
  const normalized = normalizeHostEndpoint(rawEndpoint || "", configuredHost);

  if (!SHOULD_PRESERVE_LOCALHOST && isLikelyLocalhostEndpoint(normalized)) {
    return configuredHost;
  }

  return normalized;
}

function normalizeApiEndpoint(rawEndpoint: string | undefined, provider: "ollama" | "mistral"): string {
  if (provider === "mistral") {
    return normalizeMistralEndpoint(rawEndpoint);
  }

  return normalizeOllamaEndpoint(rawEndpoint);
}

export interface ApiProviderSettings {
  provider: string;
  apiEndpoint: string;
  apiKey: string;
  obsidianBaseDir: string;
}

interface SaveApiSettingsInput extends Partial<ApiProviderSettings> {
  replaceApiKey?: boolean;
}

const DEFAULT_API_SETTINGS: ApiProviderSettings = {
  provider: "ollama",
  apiEndpoint: normalizeApiEndpoint(DEFAULT_OLLAMA_HOST, "ollama"),
  apiKey: "",
  obsidianBaseDir: DEFAULT_OBSIDIAN_BASE_DIR,
};

const SETTINGS_DIR = path.join(DATA_ROOT, "api-settings");
const settingsCache = new Map<string, ApiProviderSettings>();

const normalizeSettings = (settings: Partial<ApiProviderSettings>): ApiProviderSettings => {
  const provider = normalizeProvider(settings.provider);
  const normalizedEndpoint = normalizeApiEndpoint(settings.apiEndpoint, provider);
  const safeEndpoint = provider === "mistral"
    ? enforceProviderEndpointPolicy("mistral", normalizedEndpoint, DEFAULT_MISTRAL_OCR_ENDPOINT)
    : enforceProviderEndpointPolicy("ollama", normalizedEndpoint, FALLBACK_OLLAMA_HOST);

  return {
    provider,
    apiEndpoint: safeEndpoint,
    apiKey: settings.apiKey?.trim() || "",
    obsidianBaseDir: settings.obsidianBaseDir?.trim() || DEFAULT_OBSIDIAN_BASE_DIR,
  };
};

function sanitizeUserId(userId: string): string {
  return userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getSettingsPath(userId: string): string {
  return path.join(SETTINGS_DIR, `${sanitizeUserId(userId)}.json`);
}

function cloneSettings(settings: ApiProviderSettings): ApiProviderSettings {
  return {
    provider: settings.provider,
    apiEndpoint: settings.apiEndpoint,
    apiKey: settings.apiKey,
    obsidianBaseDir: settings.obsidianBaseDir,
  };
}

export function toClientApiSettings(settings: ApiProviderSettings): ApiProviderSettings & { hasApiKey: boolean } {
  return {
    provider: settings.provider,
    apiEndpoint: settings.apiEndpoint,
    apiKey: "",
    obsidianBaseDir: settings.obsidianBaseDir,
    hasApiKey: Boolean(settings.apiKey.trim()),
  };
}

export async function getApiSettings(userId: string): Promise<ApiProviderSettings> {
  const safeUserId = sanitizeUserId(userId);
  const cached = settingsCache.get(safeUserId);
  if (cached) {
    return cloneSettings(cached);
  }

  const settingsPath = getSettingsPath(safeUserId);
  try {
    const stored = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(stored);
    const normalized = normalizeSettings(parsed);
    settingsCache.set(safeUserId, normalized);
    return cloneSettings(normalized);
  } catch {
    await ensureSettingsDirectory();
    const normalized = normalizeSettings(DEFAULT_API_SETTINGS);
    settingsCache.set(safeUserId, normalized);
    return cloneSettings(normalized);
  }
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
      : provider === "mistral"
        ? DEFAULT_MISTRAL_OCR_ENDPOINT
        : FALLBACK_OLLAMA_HOST;
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
  return cloneSettings(normalized);
}

async function ensureSettingsDirectory() {
  await mkdir(SETTINGS_DIR, { recursive: true });
}
