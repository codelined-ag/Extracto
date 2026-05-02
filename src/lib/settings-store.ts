import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { enforceProviderEndpointPolicy, normalizeProvider, ProviderKind } from "@/lib/endpoint-policy";
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
const DEFAULT_OPENROUTER_API_ENDPOINT = normalizeHostEndpoint(
  process.env.OPENROUTER_API_URL || "",
  "https://openrouter.ai/api/v1"
);
const DEFAULT_OPENAI_COMPAT_API_ENDPOINT = normalizeHostEndpoint(
  process.env.OPENAI_COMPAT_API_URL || "",
  "https://api.openai.com/v1"
);
const SHOULD_PRESERVE_LOCALHOST =
  (process.env.APP_NETWORK_MODE || "bridge").trim().toLowerCase() === "host";
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

function normalizeOpenRouterEndpoint(rawEndpoint?: string): string {
  const normalized = normalizeHostEndpoint(rawEndpoint || "", DEFAULT_OPENROUTER_API_ENDPOINT);

  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/u, "");
    if (!pathname || pathname === "/") {
      url.pathname = "/api/v1";
    } else if (pathname.endsWith("/api")) {
      url.pathname = `${pathname}/v1`;
    } else if (pathname.endsWith("/api/v1")) {
      url.pathname = pathname;
    } else {
      url.pathname = pathname;
    }
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return DEFAULT_OPENROUTER_API_ENDPOINT;
  }
}

function normalizeOpenAICompatEndpoint(rawEndpoint?: string): string {
  // No path rewriting: OpenAI-compatible endpoints are BYO, so we must respect
  // whatever base path the operator pointed at (e.g. /v1, /api/v1, /openai/v1,
  // a self-hosted vLLM at /). We only normalize scheme + drop search/hash and
  // trailing slashes.
  const normalized = normalizeHostEndpoint(rawEndpoint || "", DEFAULT_OPENAI_COMPAT_API_ENDPOINT);
  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return DEFAULT_OPENAI_COMPAT_API_ENDPOINT;
  }
}

function normalizeApiEndpoint(rawEndpoint: string | undefined, provider: ProviderKind): string {
  if (provider === "mistral") {
    return normalizeMistralEndpoint(rawEndpoint);
  }

  if (provider === "openrouter") {
    return normalizeOpenRouterEndpoint(rawEndpoint);
  }

  if (provider === "openai_compat") {
    return normalizeOpenAICompatEndpoint(rawEndpoint);
  }

  return normalizeOllamaEndpoint(rawEndpoint);
}

export interface ApiProviderSettings {
  provider: string;
  apiEndpoint: string;
  apiKey: string;
}

interface SaveApiSettingsInput extends Partial<ApiProviderSettings> {
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
  const safeEndpoint =
    provider === "mistral"
      ? enforceProviderEndpointPolicy("mistral", normalizedEndpoint, DEFAULT_MISTRAL_OCR_ENDPOINT)
      : provider === "openrouter"
        ? enforceProviderEndpointPolicy("openrouter", normalizedEndpoint, DEFAULT_OPENROUTER_API_ENDPOINT)
        : provider === "openai_compat"
          ? enforceProviderEndpointPolicy("openai_compat", normalizedEndpoint, DEFAULT_OPENAI_COMPAT_API_ENDPOINT)
          : enforceProviderEndpointPolicy("ollama", normalizedEndpoint, FALLBACK_OLLAMA_HOST);

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


export function toClientApiSettings(settings: ApiProviderSettings): ApiProviderSettings & { hasApiKey: boolean } {
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
    try {
      const parsed = JSON.parse(stored);
      const normalized = normalizeSettings(parsed);
      settingsCache.set(safeUserId, normalized);
      return { ...normalized };
    } catch (parseErr) {
      console.error(`[settings-store] Corrupt settings file for user ${safeUserId}, resetting to defaults:`, parseErr);
    }
  } catch (readErr: unknown) {
    const code = (readErr as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(`[settings-store] Failed to read settings for user ${safeUserId}:`, readErr);
    }
  }
  await ensureSettingsDirectory();
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
      : provider === "mistral"
        ? DEFAULT_MISTRAL_OCR_ENDPOINT
        : provider === "openrouter"
          ? DEFAULT_OPENROUTER_API_ENDPOINT
          : provider === "openai_compat"
            ? DEFAULT_OPENAI_COMPAT_API_ENDPOINT
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
  return { ...normalized };
}

async function ensureSettingsDirectory() {
  await mkdir(SETTINGS_DIR, { recursive: true });
}
