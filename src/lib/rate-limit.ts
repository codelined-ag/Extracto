interface RateLimitInput {
  key: string;
  max: number;
  windowMs: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

const buckets = new Map<string, RateLimitBucket>();

function getNowMs(): number {
  return Date.now();
}

function cleanupExpiredBuckets(nowMs: number) {
  if (buckets.size < 10_000) {
    return;
  }

  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= nowMs) {
      buckets.delete(key);
    }
  }
}

export function consumeRateLimit(input: RateLimitInput): RateLimitResult {
  const nowMs = getNowMs();
  cleanupExpiredBuckets(nowMs);

  const key = input.key.trim();
  if (!key) {
    return {
      allowed: true,
      remaining: input.max,
      resetAt: nowMs + input.windowMs,
      retryAfterSeconds: 0,
    };
  }

  const current = buckets.get(key);
  if (!current || current.resetAt <= nowMs) {
    const resetAt = nowMs + input.windowMs;
    buckets.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      remaining: Math.max(0, input.max - 1),
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  if (current.count >= input.max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000)),
    };
  }

  current.count += 1;
  buckets.set(key, current);
  return {
    allowed: true,
    remaining: Math.max(0, input.max - current.count),
    resetAt: current.resetAt,
    retryAfterSeconds: 0,
  };
}

