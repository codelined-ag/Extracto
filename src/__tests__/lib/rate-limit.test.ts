import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The module-level `buckets` Map is shared across all imports within the same
// module registry. We isolate tests either by resetting modules (to get a
// pristine Map) or by advancing fake time past `windowMs` so the bucket
// expires and is treated as a new window.

describe("consumeRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin a stable starting point so relative assertions are deterministic.
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  async function fresh() {
    // resetModules() was called in afterEach but we need a fresh import for
    // each test that runs after it. Import inside the test function so the
    // module is re-evaluated with an empty buckets Map.
    const { consumeRateLimit } = await import("@/lib/rate-limit");
    return consumeRateLimit;
  }

  it("first call is allowed and remaining equals max - 1", async () => {
    const consumeRateLimit = await fresh();
    const result = consumeRateLimit({ key: "user:1", max: 5, windowMs: 60_000 });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("resetAt is set to now + windowMs on first call", async () => {
    const consumeRateLimit = await fresh();
    const now = Date.now();
    const result = consumeRateLimit({ key: "user:2", max: 5, windowMs: 60_000 });

    expect(result.resetAt).toBe(now + 60_000);
  });

  it("subsequent calls within the window decrement remaining", async () => {
    const consumeRateLimit = await fresh();
    const key = "user:3";
    const opts = { key, max: 5, windowMs: 60_000 };

    consumeRateLimit(opts); // 1 → remaining 4
    const r2 = consumeRateLimit(opts); // 2 → remaining 3
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(3);

    const r3 = consumeRateLimit(opts); // 3 → remaining 2
    expect(r3.remaining).toBe(2);

    const r4 = consumeRateLimit(opts); // 4 → remaining 1
    expect(r4.remaining).toBe(1);
  });

  it("the call at exactly max is still allowed, remaining becomes 0", async () => {
    const consumeRateLimit = await fresh();
    const key = "user:4";
    const opts = { key, max: 3, windowMs: 60_000 };

    consumeRateLimit(opts); // count 1
    consumeRateLimit(opts); // count 2
    const r3 = consumeRateLimit(opts); // count 3 — exactly max, still allowed

    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("call after max is exceeded is denied", async () => {
    const consumeRateLimit = await fresh();
    const key = "user:5";
    const opts = { key, max: 3, windowMs: 60_000 };

    consumeRateLimit(opts);
    consumeRateLimit(opts);
    consumeRateLimit(opts); // reaches max
    const denied = consumeRateLimit(opts); // one over the limit

    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("retryAfterSeconds is at least 1 when denied", async () => {
    const consumeRateLimit = await fresh();
    const key = "user:6";
    const opts = { key, max: 1, windowMs: 60_000 };

    consumeRateLimit(opts); // exhaust
    const denied = consumeRateLimit(opts);

    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("retryAfterSeconds reflects remaining window time (ceiling seconds)", async () => {
    const consumeRateLimit = await fresh();
    const key = "user:7";
    const windowMs = 60_000;
    const opts = { key, max: 1, windowMs };

    consumeRateLimit(opts); // exhaust, resetAt = now + 60_000

    // Advance 10 seconds into the window — 50 s remain.
    vi.advanceTimersByTime(10_000);

    const denied = consumeRateLimit(opts);
    // 50_000 ms remaining → ceil(50_000/1000) = 50
    expect(denied.retryAfterSeconds).toBe(50);
  });

  it("empty key is always allowed and does not track a window", async () => {
    const consumeRateLimit = await fresh();
    const opts = { key: "   ", max: 2, windowMs: 60_000 };

    const r1 = consumeRateLimit(opts);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2); // full max, no bucket consumed

    const r2 = consumeRateLimit(opts);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(2);
  });

  it("empty key retryAfterSeconds is always 0", async () => {
    const consumeRateLimit = await fresh();
    const result = consumeRateLimit({ key: "", max: 1, windowMs: 60_000 });
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("window expiry resets the counter", async () => {
    const consumeRateLimit = await fresh();
    const key = "user:8";
    const opts = { key, max: 2, windowMs: 30_000 };

    consumeRateLimit(opts);
    consumeRateLimit(opts); // exhaust the window

    const denied = consumeRateLimit(opts);
    expect(denied.allowed).toBe(false);

    // Advance time past the window so the bucket expires.
    vi.advanceTimersByTime(30_001);

    const reset = consumeRateLimit(opts);
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(1); // fresh window: max - 1 = 1
  });

  it("different keys are tracked independently", async () => {
    const consumeRateLimit = await fresh();
    const opts = { max: 1, windowMs: 60_000 };

    consumeRateLimit({ key: "a", ...opts }); // exhaust key "a"
    const resultA = consumeRateLimit({ key: "a", ...opts });
    const resultB = consumeRateLimit({ key: "b", ...opts }); // key "b" is fresh

    expect(resultA.allowed).toBe(false);
    expect(resultB.allowed).toBe(true);
  });

  it("remaining is never negative (max=1 edge case)", async () => {
    const consumeRateLimit = await fresh();
    const opts = { key: "user:9", max: 1, windowMs: 60_000 };

    const r1 = consumeRateLimit(opts);
    expect(r1.remaining).toBeGreaterThanOrEqual(0);

    const r2 = consumeRateLimit(opts); // denied
    expect(r2.remaining).toBeGreaterThanOrEqual(0);
  });
});
