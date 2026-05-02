// Provider URL normalization for persistence-time storage.
// Each function takes a user-supplied endpoint string and produces a canonical
// form to persist. Runtime normalization (used at outbound-request time) lives
// in src/app/api/ocr/route.ts and may apply additional rewrites.

import {
  isLikelyLocalhostEndpoint,
  normalizeHostEndpoint,
} from "@/lib/host-normalization";

export function normalizeMistralEndpoint(rawEndpoint: string, fallback: string): string {
  const normalized = normalizeHostEndpoint(rawEndpoint || "", fallback);

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
    return fallback;
  }
}

export function normalizeOllamaEndpoint(
  rawEndpoint: string,
  configuredHost: string,
  preserveLocalhost: boolean
): string {
  const normalized = normalizeHostEndpoint(rawEndpoint || "", configuredHost);
  if (!preserveLocalhost && isLikelyLocalhostEndpoint(normalized)) {
    return configuredHost;
  }
  return normalized;
}

export function normalizeOpenRouterEndpoint(rawEndpoint: string, fallback: string): string {
  const normalized = normalizeHostEndpoint(rawEndpoint || "", fallback);

  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/u, "");
    if (!pathname || pathname === "/") {
      url.pathname = "/api/v1";
    } else if (pathname.endsWith("/api")) {
      url.pathname = `${pathname}/v1`;
    } else {
      url.pathname = pathname;
    }
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return fallback;
  }
}

export function normalizeOpenAICompatEndpoint(rawEndpoint: string, fallback: string): string {
  // BYO endpoint: respect operator-supplied base path verbatim. Only normalize
  // scheme, drop search/hash, and trailing slashes.
  const normalized = normalizeHostEndpoint(rawEndpoint || "", fallback);
  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return fallback;
  }
}
