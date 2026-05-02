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

export type ClientApiSettings = ApiProviderSettings & { hasApiKey: boolean };
