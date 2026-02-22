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

function normalizeApiEndpoint(rawEndpoint?: string): string {
  const configuredHost = FALLBACK_OLLAMA_HOST;
  const normalized = normalizeHostEndpoint(rawEndpoint || "", configuredHost);

  if (!SHOULD_PRESERVE_LOCALHOST && isLikelyLocalhostEndpoint(normalized)) {
    return configuredHost;
  }

  return normalized;
}

export interface ApiProviderSettings {
  provider: string;
  apiEndpoint: string;
  apiKey: string;
}

const DEFAULT_API_SETTINGS: ApiProviderSettings = {
  provider: "ollama",
  apiEndpoint: normalizeApiEndpoint(DEFAULT_OLLAMA_HOST),
  apiKey: "",
};

const SETTINGS_PATH = path.join(DATA_ROOT, "api-settings.json");

const normalizeSettings = (settings: Partial<ApiProviderSettings>): ApiProviderSettings => ({
  provider: settings.provider?.trim() || DEFAULT_API_SETTINGS.provider,
  apiEndpoint: normalizeApiEndpoint(settings.apiEndpoint),
  apiKey: settings.apiKey?.trim() || "",
});

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
