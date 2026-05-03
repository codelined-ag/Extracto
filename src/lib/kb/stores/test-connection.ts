import { fetchWithTimeout, type FetchImpl } from "@/lib/kb/stores/fetch-with-timeout";

export type VectorStoreKind = "chroma" | "qdrant" | "weaviate";

export interface TestConnectionInput {
  kind: VectorStoreKind;
  baseUrl: string;
  apiKey?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  version?: string;
  endpoint: string;
  error?: string;
  status?: number;
}

const TEST_CONNECTION_TIMEOUT_MS = 8_000;

interface ProbeSpec {
  path: string;
  fallbackPath?: string;
  headers: (apiKey: string) => Record<string, string>;
  extractVersion?: (json: unknown) => string | undefined;
}

const PROBES: Record<VectorStoreKind, ProbeSpec> = {
  chroma: {
    path: "/api/v1/heartbeat",
    fallbackPath: "/api/v1/version",
    headers: (apiKey) => {
      const h: Record<string, string> = { Accept: "application/json" };
      if (apiKey) h.Authorization = `Bearer ${apiKey}`;
      return h;
    },
    extractVersion: (json) => {
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const obj = json as Record<string, unknown>;
        if (typeof obj.version === "string") return obj.version;
      }
      return undefined;
    },
  },
  qdrant: {
    path: "/",
    headers: (apiKey) => {
      const h: Record<string, string> = { Accept: "application/json" };
      if (apiKey) h["api-key"] = apiKey;
      return h;
    },
    extractVersion: (json) => {
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const obj = json as Record<string, unknown>;
        if (typeof obj.version === "string") return obj.version;
      }
      return undefined;
    },
  },
  weaviate: {
    path: "/v1/meta",
    fallbackPath: "/v1/.well-known/ready",
    headers: (apiKey) => {
      const h: Record<string, string> = { Accept: "application/json" };
      if (apiKey) h.Authorization = `Bearer ${apiKey}`;
      return h;
    },
    extractVersion: (json) => {
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const obj = json as Record<string, unknown>;
        if (typeof obj.version === "string") return obj.version;
      }
      return undefined;
    },
  },
};

function normalizeBaseUrl(rawBaseUrl: string): string {
  return rawBaseUrl.trim().replace(/\/+$/u, "");
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return `Timed out after ${TEST_CONNECTION_TIMEOUT_MS}ms`;
    }
    return error.message;
  }
  return String(error);
}

async function tryProbe(
  fetchImpl: FetchImpl,
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ resp: Response; bodyText: string } | { error: string }> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      fetchImpl,
      `${baseUrl}${path}`,
      { method: "GET", headers },
      TEST_CONNECTION_TIMEOUT_MS,
    );
  } catch (error) {
    return { error: describeFetchError(error) };
  }
  let bodyText = "";
  try {
    bodyText = await resp.text();
  } catch {
    void 0;
  }
  return { resp, bodyText };
}

function summarizeBody(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 240).replace(/\s+/gu, " ");
}

export async function testVectorStoreConnection(
  input: TestConnectionInput,
  fetchImpl: FetchImpl = fetch,
): Promise<TestConnectionResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, endpoint: "", error: "baseUrl is required" };
  }
  if (!/^https?:\/\//u.test(baseUrl)) {
    return {
      ok: false,
      latencyMs: 0,
      endpoint: "",
      error: "baseUrl must start with http:// or https://",
    };
  }

  const probe = PROBES[input.kind];
  if (!probe) {
    return {
      ok: false,
      latencyMs: 0,
      endpoint: "",
      error: `Unknown vector store kind: ${String(input.kind)}`,
    };
  }

  const headers = probe.headers(input.apiKey ?? "");
  const startedAt = performance.now();

  let attempt = await tryProbe(fetchImpl, baseUrl, probe.path, headers);
  let endpoint = probe.path;

  if (
    "resp" in attempt &&
    attempt.resp.status === 404 &&
    probe.fallbackPath
  ) {
    const fallback = await tryProbe(fetchImpl, baseUrl, probe.fallbackPath, headers);
    if ("resp" in fallback && fallback.resp.ok) {
      attempt = fallback;
      endpoint = probe.fallbackPath;
    }
  }

  const latencyMs = Math.round(performance.now() - startedAt);

  if ("error" in attempt) {
    return { ok: false, latencyMs, endpoint, error: attempt.error };
  }

  const { resp, bodyText } = attempt;
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`.trim();
    if (bodyText) {
      const summary = summarizeBody(bodyText);
      if (summary) detail = `${detail}: ${summary}`;
    }
    return { ok: false, latencyMs, endpoint, error: detail, status: resp.status };
  }

  let version: string | undefined;
  if (probe.extractVersion) {
    try {
      const parsed = bodyText ? (JSON.parse(bodyText) as unknown) : null;
      version = probe.extractVersion(parsed);
    } catch {
      void 0;
    }
  }

  return { ok: true, latencyMs, endpoint, version, status: resp.status };
}

export const TEST_CONNECTION_DEFAULT_TIMEOUT_MS = TEST_CONNECTION_TIMEOUT_MS;
