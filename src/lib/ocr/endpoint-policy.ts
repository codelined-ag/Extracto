import { normalizeHostEndpoint } from "@/lib/ocr/host-normalization";
import { type ProviderKind } from "@/lib/api-types";

export type { ProviderKind } from "@/lib/api-types";
export { normalizeProvider } from "@/lib/api-types";

const DEFAULT_OLLAMA_HOST_PATTERNS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "host.docker.internal",
  "host-gateway",
  "host.containers.internal",
  "172.17.0.1",
];

const DEFAULT_MISTRAL_HOST_PATTERNS = [
  "api.mistral.ai",
  ".mistral.ai",
];

const DEFAULT_OPENROUTER_HOST_PATTERNS = [
  "openrouter.ai",
  ".openrouter.ai",
];

const DEFAULT_OPENAI_COMPAT_HOST_PATTERNS = [
  "api.openai.com",
  ".openai.com",
];

function parsePatternList(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      if (entry.startsWith("*.")) {
        return `.${entry.slice(2)}`;
      }
      return entry;
    });
}

function normalizeHostPattern(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return trimmed;
  }
}

function hostMatchesPattern(hostname: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.startsWith(".")) {
    const bare = pattern.slice(1);
    return hostname === bare || hostname.endsWith(pattern);
  }
  return hostname === pattern;
}

function getConfiguredPatterns(provider: ProviderKind): string[] {
  if (provider === "mistral") {
    const configured = parsePatternList(process.env.MISTRAL_ALLOWED_HOSTS || "");
    return configured.length > 0 ? configured : DEFAULT_MISTRAL_HOST_PATTERNS;
  }

  if (provider === "openrouter") {
    const configured = parsePatternList(process.env.OPENROUTER_ALLOWED_HOSTS || "");
    return configured.length > 0 ? configured : DEFAULT_OPENROUTER_HOST_PATTERNS;
  }

  if (provider === "openai_compat") {
    // Additive (not replacement-only): the OpenAI-compatible slot is BYO
    // endpoint by design. An operator who lists their self-hosted vLLM
    // would otherwise silently lose access to api.openai.com.
    const configured = parsePatternList(process.env.OPENAI_COMPAT_ALLOWED_HOSTS || "");
    return configured.length > 0
      ? Array.from(new Set([...DEFAULT_OPENAI_COMPAT_HOST_PATTERNS, ...configured]))
      : DEFAULT_OPENAI_COMPAT_HOST_PATTERNS;
  }

  const configured = parsePatternList(process.env.OLLAMA_ALLOWED_HOSTS || "");
  return configured.length > 0
    ? Array.from(new Set([...DEFAULT_OLLAMA_HOST_PATTERNS, ...configured]))
    : DEFAULT_OLLAMA_HOST_PATTERNS;
}

function normalizeEndpointForValidation(rawEndpoint: string, fallbackEndpoint: string): URL {
  const normalized = normalizeHostEndpoint(rawEndpoint, fallbackEndpoint).trim();
  if (!normalized) {
    throw new Error("API endpoint is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("API endpoint must be a valid absolute URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https API endpoints are allowed");
  }

  if (parsed.username || parsed.password) {
    throw new Error("API endpoint credentials are not allowed");
  }

  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

export function enforceProviderEndpointPolicy(
  provider: ProviderKind,
  rawEndpoint: string,
  fallbackEndpoint: string
): string {
  const parsed = normalizeEndpointForValidation(rawEndpoint, fallbackEndpoint);
  const hostname = parsed.hostname.toLowerCase();
  const patterns = getConfiguredPatterns(provider).map(normalizeHostPattern).filter(Boolean);

  const allowed = patterns.some((pattern) => hostMatchesPattern(hostname, pattern));
  if (!allowed) {
    throw new Error(
      `Endpoint host "${hostname}" is not allowed for ${provider}. Allowed patterns: ${patterns.join(", ")}`
    );
  }

  return parsed.toString().replace(/\/+$/u, "");
}

