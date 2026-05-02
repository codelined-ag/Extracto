function readEnvModels(envVar: string, fallback: string[]): string[] {
  const configured = (process.env[envVar] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return configured.length > 0 ? Array.from(new Set(configured)) : fallback;
}

export const OLLAMA_DEFAULT_HOST = "http://127.0.0.1:11434";
export const OLLAMA_DISCOVERY_PATHS = ["/api/tags", "/v1/models"] as const;
export const OLLAMA_NETWORK_HINT =
  "If Ollama runs on the host machine, ensure it is bound to 0.0.0.0:11434 (not only 127.0.0.1), and from the container use a host-reachable address.";

export const DEFAULT_MISTRAL_API_URL =
  process.env.MISTRAL_OCR_API_URL?.trim() || "https://api.mistral.ai/v1/ocr";
export const DEFAULT_MISTRAL_OCR_MODEL =
  (process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest").trim();
export const DEFAULT_MISTRAL_MODELS = readEnvModels("MISTRAL_MODELS", [
  "mistral-ocr-latest",
  "mistral-ocr",
  "pixtral-12b",
]);

export const DEFAULT_OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL?.trim() || "https://openrouter.ai/api/v1";
export const OPENROUTER_REFERER = (process.env.OPENROUTER_REFERER || "").trim();
export const OPENROUTER_TITLE = (process.env.OPENROUTER_TITLE || "Extracto").trim();
export const DEFAULT_OPENROUTER_FALLBACK_MODELS = readEnvModels("OPENROUTER_MODELS", [
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash-001",
  "qwen/qwen-2-vl-72b-instruct",
]);

export const DEFAULT_OPENAI_COMPAT_API_URL =
  process.env.OPENAI_COMPAT_API_URL?.trim() || "https://api.openai.com/v1";
export const DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS = readEnvModels("OPENAI_COMPAT_MODELS", [
  "gpt-4o",
  "gpt-4o-mini",
]);
