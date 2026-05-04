import { describe, it, expect } from "vitest";
import {
  normalizeHostEndpoint,
  isLikelyLocalhostEndpoint,
  resolveOllamaHostEndpoint,
  rewriteLocalhostForContainer,
} from "@/lib/ocr/host-normalization";

// ---------------------------------------------------------------------------
// normalizeHostEndpoint
// ---------------------------------------------------------------------------

describe("normalizeHostEndpoint", () => {
  const FALLBACK = "http://localhost:11434";

  it("returns the fallback when rawEndpoint is an empty string", () => {
    expect(normalizeHostEndpoint("", FALLBACK)).toBe(FALLBACK);
  });

  it("returns the fallback when rawEndpoint is only whitespace", () => {
    expect(normalizeHostEndpoint("   ", FALLBACK)).toBe(FALLBACK);
  });

  it("strips a single trailing slash from the endpoint", () => {
    const result = normalizeHostEndpoint("http://localhost:11434/", FALLBACK);
    expect(result.endsWith("/")).toBe(false);
  });

  it("strips multiple trailing slashes from the endpoint", () => {
    const result = normalizeHostEndpoint("http://localhost:11434///", FALLBACK);
    expect(result.endsWith("/")).toBe(false);
  });

  it("preserves the http scheme", () => {
    const result = normalizeHostEndpoint("http://example.com:8080", FALLBACK);
    expect(result.startsWith("http://")).toBe(true);
  });

  it("preserves the https scheme", () => {
    const result = normalizeHostEndpoint("https://api.mistral.ai", FALLBACK);
    expect(result.startsWith("https://")).toBe(true);
  });

  it("prefixes a bare hostname with http://", () => {
    const result = normalizeHostEndpoint("localhost:11434", FALLBACK);
    expect(result).toBe("http://localhost:11434");
  });

  it("prefixes a bare domain with http://", () => {
    const result = normalizeHostEndpoint("example.com", FALLBACK);
    expect(result).toBe("http://example.com");
  });

  it("returns fallback when rawEndpoint is empty and fallback has trailing slash stripped", () => {
    // The fallback itself should be returned as normalizeScheme processes it.
    const result = normalizeHostEndpoint("", "http://localhost:11434/");
    // normalizeScheme on the fallback strips trailing slashes
    expect(result.endsWith("/")).toBe(false);
  });

  it("returns the normalized rawEndpoint and ignores fallback when rawEndpoint is valid", () => {
    const result = normalizeHostEndpoint(
      "http://172.17.0.1:11434",
      FALLBACK
    );
    expect(result).toBe("http://172.17.0.1:11434");
  });
});

// ---------------------------------------------------------------------------
// isLikelyLocalhostEndpoint
// ---------------------------------------------------------------------------

describe("isLikelyLocalhostEndpoint", () => {
  it('returns true for "http://localhost:11434"', () => {
    expect(isLikelyLocalhostEndpoint("http://localhost:11434")).toBe(true);
  });

  it('returns true for "https://localhost"', () => {
    expect(isLikelyLocalhostEndpoint("https://localhost")).toBe(true);
  });

  it('returns true for "http://127.0.0.1:11434"', () => {
    expect(isLikelyLocalhostEndpoint("http://127.0.0.1:11434")).toBe(true);
  });

  it('returns true for "http://0.0.0.0:11434"', () => {
    expect(isLikelyLocalhostEndpoint("http://0.0.0.0:11434")).toBe(true);
  });

  it('returns false for "http://api.mistral.ai"', () => {
    expect(isLikelyLocalhostEndpoint("http://api.mistral.ai")).toBe(false);
  });

  it('returns false for "https://ollama.example.com"', () => {
    expect(isLikelyLocalhostEndpoint("https://ollama.example.com")).toBe(false);
  });

  it('returns false for "http://172.17.0.1:11434" (Docker gateway, not localhost)', () => {
    expect(isLikelyLocalhostEndpoint("http://172.17.0.1:11434")).toBe(false);
  });

  it('returns false for "http://host.docker.internal:11434"', () => {
    expect(isLikelyLocalhostEndpoint("http://host.docker.internal:11434")).toBe(false);
  });

  it("returns true for bare localhost (scheme is added internally)", () => {
    // normalizeScheme adds http:// prefix before testing
    expect(isLikelyLocalhostEndpoint("localhost:11434")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveOllamaHostEndpoint
// ---------------------------------------------------------------------------

describe("resolveOllamaHostEndpoint", () => {
  it("returns the fallback when rawEndpoint is empty", () => {
    expect(
      resolveOllamaHostEndpoint("", "http://host.docker.internal:11434")
    ).toBe("http://host.docker.internal:11434");
  });

  it("replaces a localhost endpoint with the fallback (bridge-mode rewriting)", () => {
    const fallback = "http://host.docker.internal:11434";
    const result = resolveOllamaHostEndpoint("http://localhost:11434", fallback);
    expect(result).toBe(fallback);
  });

  it("replaces a 127.0.0.1 endpoint with the fallback", () => {
    const fallback = "http://host.docker.internal:11434";
    const result = resolveOllamaHostEndpoint(
      "http://127.0.0.1:11434",
      fallback
    );
    expect(result).toBe(fallback);
  });

  it("preserves a non-localhost endpoint (already an external host)", () => {
    const result = resolveOllamaHostEndpoint(
      "http://172.17.0.1:11434",
      "http://host.docker.internal:11434"
    );
    expect(result).toBe("http://172.17.0.1:11434");
  });

  it("returns the rawEndpoint when fallback is empty and rawEndpoint is non-localhost", () => {
    const result = resolveOllamaHostEndpoint("http://ollama.internal:11434", "");
    expect(result).toBe("http://ollama.internal:11434");
  });

  it("returns the rawEndpoint unchanged when it is localhost but fallback is empty", () => {
    // When fallback normalizes to empty string, the localhost endpoint is returned as-is
    // because `fallback` is falsy in the condition check.
    const result = resolveOllamaHostEndpoint("http://localhost:11434", "");
    expect(result).toBe("http://localhost:11434");
  });
});

describe("rewriteLocalhostForContainer", () => {
  it("rewrites 127.0.0.1 to a docker-gateway-reachable host while preserving port and path", () => {
    const out = rewriteLocalhostForContainer("http://127.0.0.1:8001/api/v2");
    expect(out).toMatch(/^http:\/\/(?!127\.0\.0\.1)[^/]+:8001\/api\/v2$/);
  });

  it("rewrites localhost too", () => {
    const out = rewriteLocalhostForContainer("http://localhost:6333");
    expect(out).not.toMatch(/localhost/);
    expect(out).toMatch(/:6333$/);
  });

  it("rewrites 0.0.0.0", () => {
    const out = rewriteLocalhostForContainer("http://0.0.0.0:11434/api/embed");
    expect(out).not.toMatch(/0\.0\.0\.0/);
    expect(out).toMatch(/:11434\/api\/embed$/);
  });

  it("leaves a non-localhost URL untouched", () => {
    expect(rewriteLocalhostForContainer("https://api.openai.com/v1/embeddings")).toBe(
      "https://api.openai.com/v1/embeddings",
    );
  });

  it("leaves an already-docker-internal URL untouched (no double-rewrite)", () => {
    expect(rewriteLocalhostForContainer("http://host.docker.internal:8001")).toBe(
      "http://host.docker.internal:8001",
    );
  });

  it("returns the original on garbage input", () => {
    expect(rewriteLocalhostForContainer("not a url")).toBe("not a url");
    expect(rewriteLocalhostForContainer("")).toBe("");
  });
});
