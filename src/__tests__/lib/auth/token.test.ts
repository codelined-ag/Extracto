import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  getAuthCookieName,
  getSessionMaxAgeSeconds,
  shouldUseSecureCookie,
} from "@/lib/auth/token";

const TEST_SECRET = "this-is-a-32-char-test-secret!!x";

beforeAll(() => {
  process.env.AUTH_SECRET = TEST_SECRET;
});

afterEach(() => {
  // Restore real timers after each test that may use fake timers.
  vi.useRealTimers();
  // Clear the module-level key cache by resetting the secret to the same
  // value — this forces a cache miss on the next import cycle, but since we
  // don't reset modules we just keep the same secret set.
  process.env.AUTH_SECRET = TEST_SECRET;
  // Clean up NODE_ENV / COOKIE_SECURE overrides added by individual tests.
  delete process.env.COOKIE_SECURE;
});

afterAll(() => {
  delete process.env.AUTH_SECRET;
});

// ---------------------------------------------------------------------------
// createSessionToken + verifySessionToken round-trip
// ---------------------------------------------------------------------------

describe("createSessionToken / verifySessionToken round-trip", () => {
  it("returns the original userId and email on round-trip", async () => {
    const token = await createSessionToken({ userId: "user-1", email: "test@example.com" });
    const payload = await verifySessionToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe("user-1");
    expect(payload!.email).toBe("test@example.com");
  });

  it("preserves optional name field", async () => {
    const token = await createSessionToken({
      userId: "user-2",
      email: "named@example.com",
      name: "Alice",
    });
    const payload = await verifySessionToken(token);

    expect(payload).not.toBeNull();
    expect(payload!.name).toBe("Alice");
  });

  it("produces a token in <payload>.<signature> format", async () => {
    const token = await createSessionToken({ userId: "user-3", email: "u@example.com" });
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });

  it("includes an exp claim in the future", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await createSessionToken({ userId: "user-4", email: "u@example.com" });
    const payload = await verifySessionToken(token);
    const after = Math.floor(Date.now() / 1000);

    expect(payload).not.toBeNull();
    expect(payload!.exp).toBeGreaterThan(before);
    // exp should be ~7 days in the future
    expect(payload!.exp).toBeGreaterThanOrEqual(before + 604_800 - 1);
    expect(payload!.exp).toBeLessThanOrEqual(after + 604_800 + 1);
  });
});

// ---------------------------------------------------------------------------
// verifySessionToken — null / falsy inputs
// ---------------------------------------------------------------------------

describe("verifySessionToken with null / undefined / empty input", () => {
  it("returns null for null", async () => {
    expect(await verifySessionToken(null)).toBeNull();
  });

  it("returns null for undefined", async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
  });

  it("returns null for empty string", async () => {
    expect(await verifySessionToken("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifySessionToken — tampered tokens
// ---------------------------------------------------------------------------

describe("verifySessionToken with tampered tokens", () => {
  it("returns null when the signature is tampered", async () => {
    const token = await createSessionToken({ userId: "user-5", email: "u@example.com" });
    const [payloadPart] = token.split(".");
    const tamperedToken = `${payloadPart}.invalidsignatureXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`;

    expect(await verifySessionToken(tamperedToken)).toBeNull();
  });

  it("returns null when the payload is tampered (invalid base64url json)", async () => {
    const token = await createSessionToken({ userId: "user-6", email: "u@example.com" });
    const [, sigPart] = token.split(".");
    // Replace payload with a base64url-encoded tampered JSON (different userId)
    const tamperedPayload = btoa(JSON.stringify({ userId: "hacker", email: "x@x.com", exp: 9999999999 }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    const tamperedToken = `${tamperedPayload}.${sigPart}`;

    expect(await verifySessionToken(tamperedToken)).toBeNull();
  });

  it("returns null when the payload is entirely garbled", async () => {
    expect(await verifySessionToken("notvalidbase64!@#.alsoinvalid")).toBeNull();
  });

  it("returns null for a token with no dot separator", async () => {
    expect(await verifySessionToken("tokenwithoutseparator")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifySessionToken — missing AUTH_SECRET
// ---------------------------------------------------------------------------

describe("verifySessionToken with missing AUTH_SECRET", () => {
  it("throws when AUTH_SECRET is not set (fresh module, no cache)", async () => {
    // Reset modules so the cached CryptoKey from previous tests is discarded.
    vi.resetModules();

    const savedSecret = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;

    try {
      // Re-import after resetting modules and removing AUTH_SECRET.
      const { createSessionToken: create } = await import("@/lib/auth/token");
      await expect(create({ userId: "u", email: "e@e.com" })).rejects.toThrow(
        "AUTH_SECRET is required"
      );
    } finally {
      // Restore so subsequent tests work.
      process.env.AUTH_SECRET = savedSecret ?? TEST_SECRET;
      // Reset modules again so the restored secret is picked up.
      vi.resetModules();
    }
  });

  it("throws when AUTH_SECRET is too short (fresh module, no cache)", async () => {
    vi.resetModules();

    const savedSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "tooshort";

    try {
      const { createSessionToken: create } = await import("@/lib/auth/token");
      await expect(create({ userId: "u", email: "e@e.com" })).rejects.toThrow(
        "AUTH_SECRET must be at least 32 characters"
      );
    } finally {
      process.env.AUTH_SECRET = savedSecret ?? TEST_SECRET;
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// verifySessionToken — expired token
// ---------------------------------------------------------------------------

describe("verifySessionToken with expired token", () => {
  it("returns null after SESSION_TTL_SECONDS has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const token = await createSessionToken({ userId: "user-exp", email: "exp@example.com" });

    // Advance time past the 7-day TTL
    vi.advanceTimersByTime((604_800 + 1) * 1000);

    const result = await verifySessionToken(token);
    expect(result).toBeNull();

    vi.useRealTimers();
  });

  it("is valid just before expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    const token = await createSessionToken({ userId: "user-preexp", email: "preexp@example.com" });

    // Advance time to just before the TTL expires
    vi.advanceTimersByTime((604_800 - 2) * 1000);

    const result = await verifySessionToken(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-preexp");

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// getAuthCookieName
// ---------------------------------------------------------------------------

describe("getAuthCookieName", () => {
  it('returns "estracto_session"', () => {
    expect(getAuthCookieName()).toBe("estracto_session");
  });
});

// ---------------------------------------------------------------------------
// getSessionMaxAgeSeconds
// ---------------------------------------------------------------------------

describe("getSessionMaxAgeSeconds", () => {
  it("returns 604800 (7 days in seconds)", () => {
    expect(getSessionMaxAgeSeconds()).toBe(604_800);
  });
});

// ---------------------------------------------------------------------------
// shouldUseSecureCookie
// ---------------------------------------------------------------------------

describe("shouldUseSecureCookie", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = originalNodeEnv;
    }
    delete env.COOKIE_SECURE;
  });

  it("always returns false in non-production regardless of arg", () => {
    expect(shouldUseSecureCookie(true)).toBe(false);
    expect(shouldUseSecureCookie(false)).toBe(false);
  });

  it("returns true in production when COOKIE_SECURE=true", () => {
    env.NODE_ENV = "production";
    env.COOKIE_SECURE = "true";
    expect(shouldUseSecureCookie(false)).toBe(true);
  });

  it("returns false in production when COOKIE_SECURE=false", () => {
    env.NODE_ENV = "production";
    env.COOKIE_SECURE = "false";
    expect(shouldUseSecureCookie(true)).toBe(false);
  });

  it("falls back to the arg in production when COOKIE_SECURE is unset", () => {
    env.NODE_ENV = "production";
    delete env.COOKIE_SECURE;
    expect(shouldUseSecureCookie(true)).toBe(true);
    expect(shouldUseSecureCookie(false)).toBe(false);
  });

  it("falls back to the arg in production when COOKIE_SECURE is an unrecognized value", () => {
    env.NODE_ENV = "production";
    env.COOKIE_SECURE = "yes";
    expect(shouldUseSecureCookie(true)).toBe(true);
    expect(shouldUseSecureCookie(false)).toBe(false);
  });
});
