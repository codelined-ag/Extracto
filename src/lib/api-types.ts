// Client-safe types and pure helpers — no Node.js dependencies.
// Server-only modules (settings-store, endpoint-policy) import from here
// so page.tsx can also import from here without pulling in node:fs.

export type ProviderKind = "ollama" | "mistral" | "openrouter" | "openai_compat";

export function normalizeProvider(raw?: string): ProviderKind {
  const v = raw?.trim().toLowerCase().split(":")[0];
  if (v === "mistral") return "mistral";
  if (v === "openrouter") return "openrouter";
  if (v === "openai_compat") return "openai_compat";
  return "ollama";
}

export interface ApiProviderSettings {
  provider: ProviderKind;
  apiEndpoint: string;
  apiKey: string;
}

/**
 * The shape of provider settings returned to the browser. The actual
 * apiKey is never sent — only a boolean indicating whether one is set.
 * Type intentionally omits apiKey so callers can't accidentally pretend
 * to have one.
 */
export type ClientApiSettings = Omit<ApiProviderSettings, "apiKey"> & { hasApiKey: boolean };
