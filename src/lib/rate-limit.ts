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
let sharedTableReady: Promise<void> | null = null;

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
  const nowMs = Date.now();
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

async function ensureSharedRateLimitTable(): Promise<void> {
  if (!sharedTableReady) {
    sharedTableReady = (async () => {
      const { db } = await import("@/lib/db");
      await db.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "RateLimitBucket" (
          "key" TEXT NOT NULL PRIMARY KEY,
          "count" INTEGER NOT NULL DEFAULT 0,
          "resetAt" DATETIME NOT NULL,
          "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt")`,
      );
    })();
  }
  return sharedTableReady;
}

function emptyKeyAllowed(input: RateLimitInput, nowMs: number): RateLimitResult {
  return {
    allowed: true,
    remaining: Math.max(0, input.max),
    resetAt: nowMs + input.windowMs,
    retryAfterSeconds: 0,
  };
}

function toMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function consumeSharedRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const key = input.key.trim();
  if (!key || input.max <= 0 || input.windowMs <= 0) {
    return emptyKeyAllowed(input, nowMs);
  }

  await ensureSharedRateLimitTable();
  const { db } = await import("@/lib/db");
  const { Prisma } = await import("@prisma/client");
  const now = new Date(nowMs);
  const resetAt = new Date(nowMs + input.windowMs);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ count: number; resetAt: Date | string }>>(Prisma.sql`
      SELECT "count", "resetAt"
      FROM "RateLimitBucket"
      WHERE "key" = ${key}
      LIMIT 1
    `);
    const current = rows[0];
    const currentResetAtMs = current ? toMs(current.resetAt) : 0;

    if (!current || currentResetAtMs <= nowMs) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "RateLimitBucket" ("key", "count", "resetAt", "updatedAt")
        VALUES (${key}, 1, ${resetAt}, ${now})
        ON CONFLICT("key") DO UPDATE SET
          "count" = 1,
          "resetAt" = ${resetAt},
          "updatedAt" = ${now}
      `);
      return {
        allowed: true,
        remaining: Math.max(0, input.max - 1),
        resetAt: resetAt.getTime(),
        retryAfterSeconds: 0,
      };
    }

    if (current.count >= input.max) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: currentResetAtMs,
        retryAfterSeconds: Math.max(1, Math.ceil((currentResetAtMs - nowMs) / 1000)),
      };
    }

    const nextCount = current.count + 1;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "RateLimitBucket"
      SET "count" = ${nextCount}, "updatedAt" = ${now}
      WHERE "key" = ${key}
    `);
    return {
      allowed: true,
      remaining: Math.max(0, input.max - nextCount),
      resetAt: currentResetAtMs,
      retryAfterSeconds: 0,
    };
  });
}
