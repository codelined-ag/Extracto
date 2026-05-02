// Provider configuration: pure constants vs env-derived values.
//
// PURE constants are exported directly (no env dependency).
// ENV-DERIVED values are exported as getter functions so tests can stubEnv()
// without needing vi.resetModules() — matching the lazy pattern in
// src/lib/ocr/result-store.ts.

function readEnvModels(envVar: string, fallback: string[]): string[] {
  const configured = (process.env[envVar] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return configured.length > 0 ? Array.from(new Set(configured)) : fallback;
}

// ---- Pure constants (no env dependency) -------------------------------

export const OLLAMA_DEFAULT_HOST = "http://127.0.0.1:11434";
export const OLLAMA_DISCOVERY_PATHS = ["/api/tags", "/v1/models"] as const;
export const OLLAMA_NETWORK_HINT =
  "If Ollama runs on the host machine, ensure it is bound to 0.0.0.0:11434 (not only 127.0.0.1), and from the container use a host-reachable address.";

const MISTRAL_FALLBACK_MODELS = [
  "mistral-ocr-latest",
  "mistral-ocr",
  "pixtral-12b",
];
const OPENROUTER_FALLBACK_MODELS = [
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-001",
  "qwen/qwen-2-vl-72b-instruct",
];
const OPENAI_COMPAT_FALLBACK_MODELS = ["gpt-4o", "gpt-4o-mini"];

// ---- Env-derived getters (lazy reads) ---------------------------------

export function getDefaultMistralApiUrl(): string {
  return process.env.MISTRAL_OCR_API_URL?.trim() || "https://api.mistral.ai/v1/ocr";
}

export function getDefaultMistralOcrModel(): string {
  return (process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest").trim();
}

export function getDefaultMistralModels(): string[] {
  return readEnvModels("MISTRAL_MODELS", MISTRAL_FALLBACK_MODELS);
}

export function getDefaultOpenRouterApiUrl(): string {
  return process.env.OPENROUTER_API_URL?.trim() || "https://openrouter.ai/api/v1";
}

export function getOpenRouterReferer(): string {
  return (process.env.OPENROUTER_REFERER || "").trim();
}

export function getOpenRouterTitle(): string {
  return (process.env.OPENROUTER_TITLE || "Extracto").trim();
}

export function getDefaultOpenRouterFallbackModels(): string[] {
  return readEnvModels("OPENROUTER_MODELS", OPENROUTER_FALLBACK_MODELS);
}

export function getDefaultOpenAICompatApiUrl(): string {
  return process.env.OPENAI_COMPAT_API_URL?.trim() || "https://api.openai.com/v1";
}

export function getDefaultOpenAICompatFallbackModels(): string[] {
  return readEnvModels("OPENAI_COMPAT_MODELS", OPENAI_COMPAT_FALLBACK_MODELS);
}

// All env-derived defaults are accessed via the get* functions above; no
// const re-exports — those snapshotted env at import time, which is the
// pattern this module exists to avoid.
