-- Align Prisma migration history with current schema defaults.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_AuthUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AuthUser" ("createdAt", "email", "id", "name", "passwordChangedAt", "passwordHash", "updatedAt")
SELECT "createdAt", "email", "id", "name", "passwordChangedAt", "passwordHash", "updatedAt" FROM "AuthUser";
DROP TABLE "AuthUser";
ALTER TABLE "new_AuthUser" RENAME TO "AuthUser";
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

CREATE TABLE "new_RateLimitBucket" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_RateLimitBucket" ("count", "key", "resetAt", "updatedAt")
SELECT "count", "key", "resetAt", "updatedAt" FROM "RateLimitBucket";
DROP TABLE "RateLimitBucket";
ALTER TABLE "new_RateLimitBucket" RENAME TO "RateLimitBucket";
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
