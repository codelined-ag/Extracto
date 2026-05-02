import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before any imports that use the mocked
// modules, because vi.mock() is hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("@/lib/ocr/endpoint-policy", async (importOriginal) => {
  // Keep normalizeProvider real (it is pure and has no side effects), but
  // stub enforceProviderEndpointPolicy so it simply returns its first URL
  // argument — the tests are about normalization, not allowlist policy.
  const original = await importOriginal<typeof import("@/lib/ocr/endpoint-policy")>();
  return {
    ...original,
    enforceProviderEndpointPolicy: vi.fn(
      (_provider: string, endpoint: string, _fallback: string) => endpoint
    ),
  };
});

vi.mock("@/lib/ocr/host-normalization", async (importOriginal) => {
  // Keep real implementations — they are pure string helpers.
  return importOriginal<typeof import("@/lib/ocr/host-normalization")>();
});

// ---------------------------------------------------------------------------
// Imports — after mocks are registered
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  normalizeMistralEndpointForStorage,
  getApiSettings,
  saveApiSettings,
  toClientApiSettings,
} from "@/lib/ocr/settings-store";
import { enforceProviderEndpointPolicy } from "@/lib/ocr/endpoint-policy";

const mockedReadFile = readFile as ReturnType<typeof vi.fn>;
const mockedWriteFile = writeFile as ReturnType<typeof vi.fn>;
const mockedMkdir = mkdir as ReturnType<typeof vi.fn>;
const _mockedEnforcePolicy = enforceProviderEndpointPolicy as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnoentError(): NodeJS.ErrnoException {
  const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

// ---------------------------------------------------------------------------
// normalizeMistralEndpointForStorage
// ---------------------------------------------------------------------------

describe("normalizeMistralEndpointForStorage", () => {
  it("empty string → canonical default /v1/ocr endpoint", () => {
    const result = normalizeMistralEndpointForStorage("");
    expect(result).toBe("https://api.mistral.ai/v1/ocr");
  });

  it("undefined → canonical default /v1/ocr endpoint", () => {
    const result = normalizeMistralEndpointForStorage(undefined);
    expect(result).toBe("https://api.mistral.ai/v1/ocr");
  });

  it("bare origin with no path → appends /v1/ocr", () => {
    expect(normalizeMistralEndpointForStorage("https://api.mistral.ai")).toBe(
      "https://api.mistral.ai/v1/ocr"
    );
  });

  it("/v1 path → appends /ocr to make /v1/ocr", () => {
    expect(normalizeMistralEndpointForStorage("https://api.mistral.ai/v1")).toBe(
      "https://api.mistral.ai/v1/ocr"
    );
  });

  it("already /v1/ocr → idempotent, unchanged", () => {
    expect(normalizeMistralEndpointForStorage("https://api.mistral.ai/v1/ocr")).toBe(
      "https://api.mistral.ai/v1/ocr"
    );
  });

  it("/v1/models → rewrites to /v1/ocr", () => {
    expect(normalizeMistralEndpointForStorage("https://api.mistral.ai/v1/models")).toBe(
      "https://api.mistral.ai/v1/ocr"
    );
  });

  it("/models (without /v1 prefix) → inserts /v1 and rewrites to /v1/ocr", () => {
    expect(normalizeMistralEndpointForStorage("https://api.mistral.ai/models")).toBe(
      "https://api.mistral.ai/v1/ocr"
    );
  });

  it("/ocr without /v1 prefix → inserts /v1 to get /v1/ocr", () => {
    expect(normalizeMistralEndpointForStorage("https://api.mistral.ai/ocr")).toBe(
      "https://api.mistral.ai/v1/ocr"
    );
  });

  it("trailing slashes on the root are stripped before processing", () => {
    expect(normalizeMistralEndpointForStorage("https://api.mistral.ai/")).toBe(
      "https://api.mistral.ai/v1/ocr"
    );
  });

  it("search params are stripped from the result", () => {
    const result = normalizeMistralEndpointForStorage("https://api.mistral.ai/v1/ocr?foo=bar");
    expect(result).not.toContain("?");
    expect(result).toBe("https://api.mistral.ai/v1/ocr");
  });

  it("hash fragment is stripped from the result", () => {
    const result = normalizeMistralEndpointForStorage("https://api.mistral.ai/v1/ocr#section");
    expect(result).not.toContain("#");
    expect(result).toBe("https://api.mistral.ai/v1/ocr");
  });

  it("arbitrary non-matching path is treated as a base and /v1/ocr is appended", () => {
    const result = normalizeMistralEndpointForStorage("https://api.mistral.ai/custom/base");
    expect(result).toBe("https://api.mistral.ai/custom/base/v1/ocr");
  });
});

// ---------------------------------------------------------------------------
// getApiSettings
// ---------------------------------------------------------------------------

describe("getApiSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level settings cache between tests by flushing all mocks.
    // The cache is a module-scoped Map; we work around it by using distinct
    // user IDs per test, so each test starts with a cold cache entry.
  });

  it("returns default settings (ollama) when the settings file does not exist (ENOENT)", async () => {
    mockedReadFile.mockRejectedValueOnce(makeEnoentError());
    // Use a unique userId so the module cache is cold for this test.
    const settings = await getApiSettings("user-enoent-test-1");
    expect(settings.provider).toBe("ollama");
    expect(settings.apiKey).toBe("");
    expect(typeof settings.apiEndpoint).toBe("string");
    expect(settings.apiEndpoint.length).toBeGreaterThan(0);
  });

  it("returns parsed and normalised settings when the file exists and is valid JSON", async () => {
    const stored = JSON.stringify({
      provider: "mistral",
      apiEndpoint: "https://api.mistral.ai/v1/ocr",
      apiKey: "sk-test-key",
    });
    mockedReadFile.mockResolvedValueOnce(stored);
    const settings = await getApiSettings("user-valid-json-test-1");
    expect(settings.provider).toBe("mistral");
    expect(settings.apiKey).toBe("sk-test-key");
    expect(settings.apiEndpoint).toContain("mistral.ai");
  });

  it("throws 'Settings file is corrupt' when the file contains invalid JSON", async () => {
    mockedReadFile.mockResolvedValueOnce("not-valid-json{{{{");
    await expect(getApiSettings("user-corrupt-json-test-1")).rejects.toThrow(
      "Settings file is corrupt"
    );
  });

  it("re-throws non-ENOENT filesystem errors (e.g. EACCES)", async () => {
    const accessErr = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    accessErr.code = "EACCES";
    mockedReadFile.mockRejectedValueOnce(accessErr);
    await expect(getApiSettings("user-eacces-test-1")).rejects.toThrow(
      "EACCES"
    );
  });

  it("returns default settings when file holds valid JSON but settings normalisation fails", async () => {
    // Provide a valid JSON object whose provider value is invalid; normaliseSettings
    // will call normalizeProvider which silently falls back to "ollama", so no
    // throw is expected here — the settings are silently reset to defaults.
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ provider: "garbage_provider" }));
    const settings = await getApiSettings("user-bad-provider-test-1");
    // Normalisation falls back to "ollama" default.
    expect(settings.provider).toBe("ollama");
  });
});

// ---------------------------------------------------------------------------
// saveApiSettings
// ---------------------------------------------------------------------------

describe("saveApiSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
  });

  it("saves to disk and returns normalized settings", async () => {
    // First call (getApiSettings inside saveApiSettings) → ENOENT → defaults.
    mockedReadFile.mockRejectedValueOnce(makeEnoentError());

    const result = await saveApiSettings("user-save-test-1", {
      provider: "mistral",
      apiEndpoint: "https://api.mistral.ai/v1/ocr",
      apiKey: "sk-new",
      replaceApiKey: true,
    });

    expect(result.provider).toBe("mistral");
    expect(result.apiKey).toBe("sk-new");
    expect(mockedWriteFile).toHaveBeenCalledOnce();
    expect(mockedMkdir).toHaveBeenCalledOnce();
  });

  it("when provider changes the endpoint resets to the provider default", async () => {
    // Simulate stored openrouter settings.
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({
        provider: "openrouter",
        apiEndpoint: "https://openrouter.ai/api/v1",
        apiKey: "",
      })
    );

    const result = await saveApiSettings("user-provider-change-test-1", {
      provider: "mistral",
    });

    expect(result.provider).toBe("mistral");
    // Endpoint should have been reset to a mistral default (contains mistral.ai).
    expect(result.apiEndpoint).toContain("mistral.ai");
    expect(mockedWriteFile).toHaveBeenCalledOnce();
  });

  it("when replaceApiKey is false the existing apiKey is preserved", async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({
        provider: "mistral",
        apiEndpoint: "https://api.mistral.ai/v1/ocr",
        apiKey: "old-key",
      })
    );

    const result = await saveApiSettings("user-keep-key-test-1", {
      provider: "mistral",
      replaceApiKey: false,
      apiKey: "new-ignored-key",
    });

    expect(result.apiKey).toBe("old-key");
  });

  it("when replaceApiKey is true the new apiKey overwrites the existing one", async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({
        provider: "mistral",
        apiEndpoint: "https://api.mistral.ai/v1/ocr",
        apiKey: "old-key",
      })
    );

    const result = await saveApiSettings("user-replace-key-test-1", {
      provider: "mistral",
      replaceApiKey: true,
      apiKey: "brand-new-key",
    });

    expect(result.apiKey).toBe("brand-new-key");
  });

  it("whitespace in apiKey is trimmed when replaceApiKey is true", async () => {
    mockedReadFile.mockRejectedValueOnce(makeEnoentError());

    const result = await saveApiSettings("user-trim-key-test-1", {
      provider: "mistral",
      replaceApiKey: true,
      apiKey: "  spaced-key  ",
    });

    expect(result.apiKey).toBe("spaced-key");
  });

  it("ensures the settings directory exists (mkdir recursive) on every save", async () => {
    mockedReadFile.mockRejectedValueOnce(makeEnoentError());
    await saveApiSettings("user-mkdir-test-1", { provider: "ollama" });
    expect(mockedMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// toClientApiSettings
// ---------------------------------------------------------------------------

describe("toClientApiSettings", () => {
  it("omits apiKey entirely and sets hasApiKey:false when key is empty", () => {
    const client = toClientApiSettings({
      provider: "ollama",
      apiEndpoint: "http://localhost:11434",
      apiKey: "",
    });
    expect("apiKey" in client).toBe(false);
    expect(client.hasApiKey).toBe(false);
  });

  it("sets hasApiKey:true when key is non-empty but never includes the key in the response", () => {
    const client = toClientApiSettings({
      provider: "mistral",
      apiEndpoint: "https://api.mistral.ai/v1/ocr",
      apiKey: "secret-token",
    });
    expect("apiKey" in client).toBe(false);
    expect(client.hasApiKey).toBe(true);
  });

  it("sets hasApiKey:false when key is only whitespace", () => {
    const client = toClientApiSettings({
      provider: "mistral",
      apiEndpoint: "https://api.mistral.ai/v1/ocr",
      apiKey: "   ",
    });
    expect(client.hasApiKey).toBe(false);
  });

  it("preserves provider and apiEndpoint in the client view", () => {
    const client = toClientApiSettings({
      provider: "openrouter",
      apiEndpoint: "https://openrouter.ai/api/v1",
      apiKey: "",
    });
    expect(client.provider).toBe("openrouter");
    expect(client.apiEndpoint).toBe("https://openrouter.ai/api/v1");
  });
});
