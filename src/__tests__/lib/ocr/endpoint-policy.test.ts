import { describe, it, expect, afterEach, vi } from "vitest";
import {
  normalizeProvider,
  enforceProviderEndpointPolicy,
} from "@/lib/ocr/endpoint-policy";

// ---------------------------------------------------------------------------
// normalizeProvider
// ---------------------------------------------------------------------------

describe("normalizeProvider", () => {
  it('returns "mistral" for "mistral"', () => {
    expect(normalizeProvider("mistral")).toBe("mistral");
  });

  it('returns "mistral" for "MISTRAL" (case-insensitive)', () => {
    expect(normalizeProvider("MISTRAL")).toBe("mistral");
  });

  it('returns "mistral" for "mistral:extra" (strips colon suffix)', () => {
    expect(normalizeProvider("mistral:extra")).toBe("mistral");
  });

  it('returns "openrouter" for "openrouter"', () => {
    expect(normalizeProvider("openrouter")).toBe("openrouter");
  });

  it('returns "openai_compat" for "openai_compat"', () => {
    expect(normalizeProvider("openai_compat")).toBe("openai_compat");
  });

  it('returns "ollama" for "ollama"', () => {
    expect(normalizeProvider("ollama")).toBe("ollama");
  });

  it('returns "ollama" for an unknown string', () => {
    expect(normalizeProvider("unknown")).toBe("ollama");
  });

  it('returns "ollama" for undefined', () => {
    expect(normalizeProvider(undefined)).toBe("ollama");
  });

  it('returns "ollama" for an empty string', () => {
    expect(normalizeProvider("")).toBe("ollama");
  });
});

// ---------------------------------------------------------------------------
// enforceProviderEndpointPolicy
// ---------------------------------------------------------------------------

describe("enforceProviderEndpointPolicy", () => {
  // Ensure env vars injected by one test don't bleed into the next.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Mistral ──────────────────────────────────────────────────────────────

  describe("mistral provider", () => {
    it("allows the canonical Mistral OCR endpoint", () => {
      vi.stubEnv("MISTRAL_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "mistral",
          "https://api.mistral.ai/v1/ocr",
          ""
        )
      ).not.toThrow();
    });

    it("allows a subdomain of mistral.ai (matches .mistral.ai pattern)", () => {
      vi.stubEnv("MISTRAL_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "mistral",
          "https://custom.mistral.ai/v1",
          ""
        )
      ).not.toThrow();
    });

    it("throws for a custom host not in MISTRAL_ALLOWED_HOSTS", () => {
      vi.stubEnv("MISTRAL_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "mistral",
          "https://mymistral.example.com/v1",
          ""
        )
      ).toThrow();
    });

    it("allows a custom host when it is listed in MISTRAL_ALLOWED_HOSTS", () => {
      vi.stubEnv("MISTRAL_ALLOWED_HOSTS", "mymistral.example.com");
      expect(() =>
        enforceProviderEndpointPolicy(
          "mistral",
          "https://mymistral.example.com/v1",
          ""
        )
      ).not.toThrow();
    });
  });

  // ── Ollama ───────────────────────────────────────────────────────────────

  describe("ollama provider", () => {
    it("allows localhost", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "http://localhost:11434",
          ""
        )
      ).not.toThrow();
    });

    it("allows 127.0.0.1", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "http://127.0.0.1:11434",
          ""
        )
      ).not.toThrow();
    });

    it("allows the Docker gateway 172.17.0.1", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "http://172.17.0.1:11434",
          ""
        )
      ).not.toThrow();
    });

    it("throws for an arbitrary external host", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "https://external.example.com:11434",
          ""
        )
      ).toThrow();
    });

    it("allows an external host added via OLLAMA_ALLOWED_HOSTS (additive)", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "external.example.com");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "https://external.example.com:11434",
          ""
        )
      ).not.toThrow();
    });

    it("localhost is still allowed when OLLAMA_ALLOWED_HOSTS adds an extra host", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "external.example.com");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "http://localhost:11434",
          ""
        )
      ).not.toThrow();
    });
  });

  // ── OpenRouter ───────────────────────────────────────────────────────────

  describe("openrouter provider", () => {
    it("allows openrouter.ai", () => {
      vi.stubEnv("OPENROUTER_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "openrouter",
          "https://openrouter.ai/api/v1",
          ""
        )
      ).not.toThrow();
    });

    it("throws for a host not in the OpenRouter allowlist", () => {
      vi.stubEnv("OPENROUTER_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "openrouter",
          "https://other.example.com/api/v1",
          ""
        )
      ).toThrow();
    });
  });

  // ── openai_compat ────────────────────────────────────────────────────────

  describe("openai_compat provider", () => {
    it("allows api.openai.com by default", () => {
      vi.stubEnv("OPENAI_COMPAT_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "openai_compat",
          "https://api.openai.com/v1",
          ""
        )
      ).not.toThrow();
    });

    it("throws for a custom host when OPENAI_COMPAT_ALLOWED_HOSTS is unset", () => {
      vi.stubEnv("OPENAI_COMPAT_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "openai_compat",
          "https://myvllm.local/v1",
          ""
        )
      ).toThrow();
    });

    it("allows a custom host listed in OPENAI_COMPAT_ALLOWED_HOSTS", () => {
      vi.stubEnv("OPENAI_COMPAT_ALLOWED_HOSTS", "myvllm.local");
      expect(() =>
        enforceProviderEndpointPolicy(
          "openai_compat",
          "https://myvllm.local/v1",
          ""
        )
      ).not.toThrow();
    });

    it("api.openai.com is still allowed when OPENAI_COMPAT_ALLOWED_HOSTS adds a custom host (additive, not replacement)", () => {
      vi.stubEnv("OPENAI_COMPAT_ALLOWED_HOSTS", "myvllm.local");
      expect(() =>
        enforceProviderEndpointPolicy(
          "openai_compat",
          "https://api.openai.com/v1",
          ""
        )
      ).not.toThrow();
    });
  });

  // ── Generic validation ────────────────────────────────────────────────────

  describe("general URL validation", () => {
    it("throws for a non-http/https scheme", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "ftp://localhost:11434",
          ""
        )
      ).toThrow();
    });

    it("throws when credentials are embedded in the URL", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      expect(() =>
        enforceProviderEndpointPolicy(
          "ollama",
          "http://user:pass@localhost:11434",
          ""
        )
      ).toThrow();
    });

    it("returns a URL without a trailing slash", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      const result = enforceProviderEndpointPolicy(
        "ollama",
        "http://localhost:11434/",
        ""
      );
      expect(result.endsWith("/")).toBe(false);
    });

    it("returns a URL without a trailing slash when multiple slashes are present", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      const result = enforceProviderEndpointPolicy(
        "ollama",
        "http://localhost:11434///",
        ""
      );
      expect(result.endsWith("/")).toBe(false);
    });

    it("strips query string and fragment from the returned URL", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      const result = enforceProviderEndpointPolicy(
        "ollama",
        "http://localhost:11434/api?foo=bar#frag",
        ""
      );
      expect(result).not.toContain("?");
      expect(result).not.toContain("#");
    });

    it("falls back to fallbackEndpoint when rawEndpoint is empty", () => {
      vi.stubEnv("OLLAMA_ALLOWED_HOSTS", "");
      const result = enforceProviderEndpointPolicy(
        "ollama",
        "",
        "http://localhost:11434"
      );
      expect(result).toContain("localhost");
    });
  });
});
