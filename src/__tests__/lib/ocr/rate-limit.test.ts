import { describe, it, expect, beforeEach } from "vitest";
import { enforceOcrSubmitRateLimit, OCR_RATE_LIMIT_MAX, OCR_RATE_LIMIT_WINDOW_MS } from "@/lib/ocr/rate-limit";
import type { AuthContext } from "@/lib/auth/request";

function authSession(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "u1",
    method: "session",
    apiKeyId: null,
    scopes: ["*"],
    rateLimitPerMinute: null,
    ...overrides,
  };
}

function authBearer(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "u2",
    method: "api-key",
    apiKeyId: `k${Math.random().toString(36).slice(2, 8)}`,
    scopes: ["*"],
    rateLimitPerMinute: null,
    ...overrides,
  };
}

describe("enforceOcrSubmitRateLimit", () => {
  beforeEach(() => {
    // each user+ip combo gets a fresh rate-limit bucket per test by virtue
    // of the random apiKeyId / unique ip
  });

  it("returns null while within the per-user-IP limit", () => {
    const auth = authSession({ userId: `u-${Math.random()}` });
    for (let i = 0; i < OCR_RATE_LIMIT_MAX; i++) {
      expect(enforceOcrSubmitRateLimit(auth, "1.2.3.4")).toBeNull();
    }
  });

  it("returns 429 once the per-user-IP limit is exhausted", () => {
    const auth = authSession({ userId: `u-${Math.random()}` });
    for (let i = 0; i < OCR_RATE_LIMIT_MAX; i++) enforceOcrSubmitRateLimit(auth, "1.2.3.5");
    const res = enforceOcrSubmitRateLimit(auth, "1.2.3.5");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("uses per-key bucket when method=api-key", () => {
    const auth = authBearer();
    for (let i = 0; i < OCR_RATE_LIMIT_MAX; i++) {
      expect(enforceOcrSubmitRateLimit(auth, "ignored")).toBeNull();
    }
    expect(enforceOcrSubmitRateLimit(auth, "ignored")!.status).toBe(429);
  });

  it("honors per-key rateLimitPerMinute override", () => {
    const auth = authBearer({ rateLimitPerMinute: 2 });
    expect(enforceOcrSubmitRateLimit(auth, "x")).toBeNull();
    expect(enforceOcrSubmitRateLimit(auth, "x")).toBeNull();
    expect(enforceOcrSubmitRateLimit(auth, "x")!.status).toBe(429);
  });

  it("ignores rateLimitPerMinute when it is null/zero/negative", () => {
    const auth = authBearer({ rateLimitPerMinute: 0 });
    for (let i = 0; i < OCR_RATE_LIMIT_MAX; i++) {
      expect(enforceOcrSubmitRateLimit(auth, "x")).toBeNull();
    }
    expect(enforceOcrSubmitRateLimit(auth, "x")!.status).toBe(429);
  });

  it("constants expose the default window + max", () => {
    expect(OCR_RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(OCR_RATE_LIMIT_MAX).toBe(6);
  });
});
