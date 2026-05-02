import { readFileSync } from "node:fs";

const LOCALHOST_PATTERNS =
  /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?(?:\/.*)?$/iu;
const FALLBACK_PORT = 11434;
const DEFAULT_DOCKER_HOST_FALLBACKS = [
  "host.docker.internal:11434",
  "host-gateway:11434",
  "host.containers.internal:11434",
  "172.17.0.1:11434",
];

function parsePort(endpoint: string, fallback = FALLBACK_PORT): string {
  try {
    const url = endpoint.startsWith("http://") || endpoint.startsWith("https://")
      ? new URL(endpoint)
      : new URL(`http://${endpoint}`);
    return `${url.port || fallback}`;
  } catch {
    const match = endpoint.match(/:(\d+)(?:\/.*)?$/u);
    return match?.[1] ? match[1] : `${fallback}`;
  }
}

function getContainerGatewayHosts(fallbackPort: string): string[] {
  try {
    const raw = readFileSync("/proc/net/route", "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const gateways = lines
      .slice(1)
      .map((line) => line.trim().split(/\s+/u))
      .filter((parts) => parts.length >= 3 && parts[1] === "00000000")
      .map((parts) => parts[2])
      .filter(Boolean)
      .map((hex) => {
        const normalized = Number.parseInt(hex, 16) >>> 0;
        if (!Number.isFinite(normalized) || normalized <= 0) {
          return "";
        }

        const octets = [
          (normalized >> 0) & 0xff,
          (normalized >> 8) & 0xff,
          (normalized >> 16) & 0xff,
          (normalized >> 24) & 0xff,
        ];

        return `${octets[0]}.${octets[1]}.${octets[2]}.${octets[3]}`;
      })
      .filter((gateway) => gateway && gateway !== "0.0.0.0" && gateway !== "255.255.255.255");

    return Array.from(new Set(gateways.map((gateway) => `http://${gateway}:${fallbackPort}`)));
  } catch {
    return [];
  }
}

function normalizeScheme(rawEndpoint: string): string {
  const trimmed = rawEndpoint.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    return "";
  }

  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//u.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function normalizeHostEndpoint(rawEndpoint: string, fallback: string): string {
  const normalized = normalizeScheme(rawEndpoint);
  return normalized || normalizeScheme(fallback);
}

export function isLikelyLocalhostEndpoint(endpoint: string): boolean {
  return LOCALHOST_PATTERNS.test(normalizeScheme(endpoint));
}

export function resolveOllamaHostEndpoint(
  rawEndpoint: string,
  fallbackHost: string
): string {
  const fallback = normalizeScheme(fallbackHost);
  const normalized = normalizeScheme(rawEndpoint);

  if (!normalized) {
    return fallback;
  }

  if (isLikelyLocalhostEndpoint(normalized) && fallback) {
    return fallback;
  }

  return normalized;
}

function dedupeHosts(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseCustomHostFallbacks(): string[] {
  const configured = (process.env.OLLAMA_HOST_FALLBACKS || process.env.OLLAMA_HOSTS || "").trim();
  if (!configured) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of configured.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function shouldUseDockerFallbacks(rawEndpoint: string, fallbackHost: string): boolean {
  return (
    isLikelyLocalhostEndpoint(rawEndpoint) ||
    isLikelyLocalhostEndpoint(fallbackHost) ||
    /host(?:\.docker)?\.internal|host-gateway|host\.containers\.internal|172\.17\.0\.1/i.test(rawEndpoint) ||
    /host(?:\.docker)?\.internal|host-gateway|host\.containers\.internal|172\.17\.0\.1/i.test(fallbackHost)
  );
}

export function buildOllamaHostCandidates(
  rawEndpoint: string,
  fallbackHost: string
): string[] {
  const resolvedHost = resolveOllamaHostEndpoint(rawEndpoint, fallbackHost);
  const resolvedFallback = normalizeHostEndpoint(fallbackHost, resolvedHost);
  const candidates: string[] = [resolvedHost];

  if (resolvedFallback && resolvedFallback !== resolvedHost) {
    candidates.push(resolvedFallback);
  }

  if (shouldUseDockerFallbacks(resolvedHost, resolvedFallback)) {
    const fallbackPort = parsePort(resolvedHost || resolvedFallback || "http://127.0.0.1:11434");
    for (const fallback of [
      ...getContainerGatewayHosts(fallbackPort),
      ...parseCustomHostFallbacks(),
      ...DEFAULT_DOCKER_HOST_FALLBACKS,
    ]) {
      const normalizedFallback = normalizeHostEndpoint(fallback, "");
      if (normalizedFallback) {
        candidates.push(normalizedFallback);
      }
    }
  }

  return dedupeHosts(candidates);
}
