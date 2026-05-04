import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";

import { ApiRouteError } from "@/lib/api-error";
import { normalizeHostEndpoint } from "@/lib/ocr/host-normalization";
import { type ProviderKind } from "@/lib/api-types";

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
    throw new ApiRouteError("API endpoint is required", 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ApiRouteError("API endpoint must be a valid absolute URL", 400);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiRouteError("Only http and https API endpoints are allowed", 400);
  }

  if (parsed.username || parsed.password) {
    throw new ApiRouteError("API endpoint credentials are not allowed", 400);
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
    throw new ApiRouteError(
      `Endpoint host "${hostname}" is not allowed for ${provider}. Allowed patterns: ${patterns.join(", ")}`,
      400,
    );
  }

  return parsed.toString().replace(/\/+$/u, "");
}

const DEFAULT_VECTOR_STORE_HOST_PATTERNS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "host.docker.internal",
  "host-gateway",
  "host.containers.internal",
  "172.17.0.1",
];

const BLOCKED_HOST_LITERALS: ReadonlySet<string> = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.azure.com",
  "metadata.packet.net",
  "metadata.platformequinix.com",
]);

function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    out.push(n);
  }
  return out as [number, number, number, number];
}

function stripIPv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function normalizeHostname(rawHostname: string): string {
  return stripIPv6Brackets(rawHostname.toLowerCase()).replace(/\.$/, "");
}

/**
 * True for any host that is **always** unsafe regardless of policy: cloud
 * metadata services and the AWS IMDS link-local literal, plus IPv6 link-local
 * IMDS variants. Loopback and RFC1918 are NOT included here — those are
 * legitimate for Ollama / Chroma / etc. and must be denied per-policy when
 * the per-policy allowlist excludes them.
 */
function isUnconditionallyBlockedHost(rawHostname: string): boolean {
  const hostname = normalizeHostname(rawHostname);
  if (BLOCKED_HOST_LITERALS.has(hostname)) return true;

  const v4 = parseIPv4(hostname);
  if (v4 && v4[0] === 169 && v4[1] === 254) return true; // 169.254.0.0/16 link-local

  if (hostname === "::ffff:a9fe:a9fe") return true;      // IPv4-mapped IMDS
  if (hostname.startsWith("::ffff:")) {
    const tail = hostname.slice("::ffff:".length);
    const mapped = parseIPv4(tail);
    if (mapped && mapped[0] === 169 && mapped[1] === 254) return true;
  }
  if (hostname.startsWith("fe80:")) return true;         // IPv6 link-local
  return false;
}

/**
 * Stricter than isUnconditionallyBlockedHost — also blocks loopback, RFC1918,
 * CGNAT, ULA-IPv6, "0.0.0.0", "host-gateway", and Docker bridge IPs.
 * Used by S3 to deny the AWS-SDK-as-signed-HTTP-request gadget against the
 * Extracto host's internal services. Opt out per-deployment with
 * S3_ALLOW_LOOPBACK=1 (e.g. local MinIO sidecar testing).
 */
function isPrivateOrLoopbackHost(rawHostname: string): boolean {
  if (isUnconditionallyBlockedHost(rawHostname)) return true;
  const hostname = normalizeHostname(rawHostname);

  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "host.docker.internal" || hostname === "host.containers.internal") return true;
  if (hostname === "host-gateway") return true;

  const v4 = parseIPv4(hostname);
  if (v4) {
    const [a, b] = v4;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (hostname === "::1" || hostname === "::") return true;
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  if (hostname.startsWith("::ffff:")) {
    const tail = hostname.slice("::ffff:".length);
    const mapped = parseIPv4(tail);
    if (mapped) {
      return isPrivateOrLoopbackHost(`${mapped[0]}.${mapped[1]}.${mapped[2]}.${mapped[3]}`);
    }
  }
  return false;
}

function getVectorStorePatterns(): string[] {
  const configured = parsePatternList(process.env.VECTOR_STORE_ALLOWED_HOSTS || "");
  return configured.length > 0
    ? Array.from(new Set([...DEFAULT_VECTOR_STORE_HOST_PATTERNS, ...configured]))
    : DEFAULT_VECTOR_STORE_HOST_PATTERNS;
}

function rejectBlockedHost(hostname: string): void {
  if (isUnconditionallyBlockedHost(hostname)) {
    throw new ApiRouteError(
      `Endpoint host "${hostname}" is blocked (cloud-metadata or link-local IMDS address)`,
      400,
    );
  }
}

export function enforceVectorStoreEndpointPolicy(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    throw new ApiRouteError("baseUrl is required", 400);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiRouteError("baseUrl must be a valid absolute URL", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiRouteError("Only http and https baseUrls are allowed", 400);
  }
  if (parsed.username || parsed.password) {
    throw new ApiRouteError("baseUrl credentials are not allowed", 400);
  }
  parsed.search = "";
  parsed.hash = "";

  const hostname = parsed.hostname.toLowerCase();
  rejectBlockedHost(hostname);

  const patterns = getVectorStorePatterns().map(normalizeHostPattern).filter(Boolean);
  const allowed = patterns.some((pattern) => hostMatchesPattern(hostname, pattern));
  if (!allowed) {
    throw new ApiRouteError(
      `Vector store host "${hostname}" is not allowed. Set VECTOR_STORE_ALLOWED_HOSTS to extend the allowlist (current: ${patterns.join(", ")}).`,
      400,
    );
  }

  return parsed.toString().replace(/\/+$/u, "");
}

function s3LoopbackOptedIn(): boolean {
  const flag = (process.env.S3_ALLOW_LOOPBACK || "").trim().toLowerCase();
  return flag === "1" || flag === "true";
}

function s3HostExplicitlyAllowed(hostname: string): boolean {
  const configured = parsePatternList(process.env.S3_ALLOWED_HOSTS || "")
    .map(normalizeHostPattern)
    .filter(Boolean);
  return configured.some((pattern) => hostMatchesPattern(hostname, pattern));
}

/**
 * Open by default to any S3-compatible host (AWS, R2, Backblaze, MinIO,
 * Garage, Ceph, SeaweedFS, on-prem, ...). The only refusals are
 * SSRF-relevant: cloud-metadata IPs (always), and private/loopback ranges
 * unless explicitly opted in.
 *
 * Two opt-in mechanisms for private hosts:
 *  - S3_ALLOW_LOOPBACK=1 — global opt-in, allows all RFC1918/loopback/Docker hosts
 *  - S3_ALLOWED_HOSTS=foo.internal,*.bar.internal — granular opt-in, only those names
 */
export function enforceS3EndpointPolicy(rawEndpoint: string): string {
  const trimmed = rawEndpoint.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiRouteError("S3 endpoint must be a valid absolute URL", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ApiRouteError("S3 endpoint must use http or https", 400);
  }
  if (parsed.username || parsed.password) {
    throw new ApiRouteError("S3 endpoint must not embed credentials", 400);
  }
  parsed.search = "";
  parsed.hash = "";

  const hostname = normalizeHostname(parsed.hostname);
  rejectBlockedHost(hostname);

  if (isPrivateOrLoopbackHost(hostname) && !s3LoopbackOptedIn() && !s3HostExplicitlyAllowed(hostname)) {
    throw new ApiRouteError(
      `S3 endpoint host "${hostname}" is private/loopback. Set S3_ALLOW_LOOPBACK=1 to allow all private hosts, or list it in S3_ALLOWED_HOSTS for granular access.`,
      400,
    );
  }

  return parsed.toString().replace(/\/+$/u, "");
}

function shouldResolveHostname(hostname: string): boolean {
  return !parseIPv4(hostname) && !hostname.includes(":");
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function normalizeLookupOptions(options: unknown): LookupOptions & { all?: boolean } {
  if (typeof options === "number") {
    return { family: options };
  }
  if (options && typeof options === "object") {
    return options as LookupOptions & { all?: boolean };
  }
  return {};
}

function lookupError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "EHOSTUNREACH";
  return error;
}

function s3PrivateResolutionAllowed(hostname: string, baseHostname?: string): boolean {
  if (s3LoopbackOptedIn() || s3HostExplicitlyAllowed(hostname)) return true;
  return Boolean(baseHostname && hostname.endsWith(`.${baseHostname}`) && s3HostExplicitlyAllowed(baseHostname));
}

function validateS3ResolvedAddresses(
  hostname: string,
  records: Array<{ address: string }>,
  baseHostname?: string,
): void {
  if (records.length === 0) {
    throw lookupError(`S3 endpoint host "${hostname}" did not resolve to any address`);
  }

  const privateResolutionAllowed = s3PrivateResolutionAllowed(hostname, baseHostname);
  for (const record of records) {
    const address = normalizeHostname(record.address);
    if (isUnconditionallyBlockedHost(address)) {
      throw lookupError(`S3 endpoint host "${hostname}" resolves to blocked address ${address}`);
    }
    if (isPrivateOrLoopbackHost(address) && !privateResolutionAllowed) {
      throw lookupError(
        `S3 endpoint host "${hostname}" resolves to private/loopback address ${address}. Set S3_ALLOW_LOOPBACK=1 to allow all private hosts, or list the hostname in S3_ALLOWED_HOSTS for granular access.`,
      );
    }
  }
}

export function createS3EndpointLookup(rawEndpoint: string): typeof dnsLookup {
  const endpoint = enforceS3EndpointPolicy(rawEndpoint);
  const baseHostname = endpoint ? normalizeHostname(new URL(endpoint).hostname) : undefined;
  const guardedLookup = (
    hostname: string,
    optionsOrCallback: LookupOptions | number | LookupCallback,
    maybeCallback?: LookupCallback,
  ): void => {
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    if (!callback) {
      throw new TypeError("callback is required");
    }
    const requestedOptions = typeof optionsOrCallback === "function" ? {} : normalizeLookupOptions(optionsOrCallback);
    const wantsAll = requestedOptions.all === true;
    const normalizedHost = normalizeHostname(hostname);
    dnsLookup(hostname, { ...requestedOptions, all: true, verbatim: true }, (err, records) => {
      if (err) {
        callback(err, "", 0);
        return;
      }
      try {
        validateS3ResolvedAddresses(normalizedHost, records, baseHostname);
      } catch (error) {
        callback(error as NodeJS.ErrnoException, "", 0);
        return;
      }
      if (wantsAll) {
        callback(null, records);
        return;
      }
      const first = records[0];
      callback(null, first.address, first.family);
    });
  };

  return guardedLookup as typeof dnsLookup;
}

export async function resolveAndEnforceS3EndpointPolicy(rawEndpoint: string): Promise<string> {
  const endpoint = enforceS3EndpointPolicy(rawEndpoint);
  if (!endpoint) return "";

  const parsed = new URL(endpoint);
  const hostname = normalizeHostname(parsed.hostname);
  if (!shouldResolveHostname(hostname)) {
    return endpoint;
  }

  let records: Array<{ address: string }> = [];
  try {
    const dns = await import("node:dns/promises");
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new ApiRouteError(
      `DNS lookup failed for S3 endpoint host "${hostname}": ${err instanceof Error ? err.message : String(err)}`,
      400,
    );
  }

  if (records.length === 0) {
    throw new ApiRouteError(`S3 endpoint host "${hostname}" did not resolve to any address`, 400);
  }

  try {
    validateS3ResolvedAddresses(hostname, records);
  } catch (error) {
    throw new ApiRouteError(error instanceof Error ? error.message : String(error), 400);
  }

  return endpoint;
}
