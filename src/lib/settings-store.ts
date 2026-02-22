import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
}

const DEFAULT_API_SETTINGS: ApiProviderSettings = {
  provider: "ollama",
  apiEndpoint: normalizeApiEndpoint(DEFAULT_OLLAMA_HOST, "ollama"),
  apiKey: "",
};

const SETTINGS_PATH = path.join(DATA_ROOT, "api-settings.json");

const normalizeSettings = (settings: Partial<ApiProviderSettings>): ApiProviderSettings => {
  const provider = normalizeProvider(settings.provider);
  return {
    provider,
    apiEndpoint: normalizeApiEndpoint(settings.apiEndpoint, provider),
    apiKey: settings.apiKey?.trim() || "",
  };
};

export async function getApiSettings(): Promise<ApiProviderSettings> {
  try {
    const stored = await readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(stored);
    return normalizeSettings(parsed);
  } catch {
    await ensureSettingsDirectory();
    return DEFAULT_API_SETTINGS;
  }
}

export async function saveApiSettings(
  settings: Partial<ApiProviderSettings>
): Promise<ApiProviderSettings> {
  const normalized = normalizeSettings(settings);
  await ensureSettingsDirectory();
  await writeFile(SETTINGS_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

async function ensureSettingsDirectory() {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
}
