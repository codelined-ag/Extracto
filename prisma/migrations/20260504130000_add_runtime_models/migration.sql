-- Add runtime tables and columns that the application schema already uses.
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OcrJobTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'generic',
    "language" TEXT NOT NULL DEFAULT 'auto',
    "customPrompt" TEXT NOT NULL DEFAULT '',
    "postProcessing" JSONB,
    "autoExports" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OcrJobTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WatchedS3Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "model" TEXT NOT NULL,
    "templateId" TEXT,
    "autoKbExport" BOOLEAN NOT NULL DEFAULT false,
    "autoS3Export" BOOLEAN NOT NULL DEFAULT false,
    "lastPolledAt" DATETIME,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WatchedS3Source_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WatchedS3Object" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "etag" TEXT,
    "jobId" TEXT,
    "ingestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchedS3Object_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WatchedS3Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "OcrSetting" ADD COLUMN "autoRetryMaxAttempts" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "OcrJob" ADD COLUMN "comparisonId" TEXT;
ALTER TABLE "OcrJob" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OcrJob" ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OcrJob" ADD COLUMN "nextRetryAt" DATETIME;
ALTER TABLE "OcrJob" ADD COLUMN "userEdited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OcrJob" ADD COLUMN "editedAt" DATETIME;

CREATE INDEX "WebhookDelivery_webhookId_attemptedAt_idx" ON "WebhookDelivery"("webhookId", "attemptedAt" DESC);

CREATE INDEX "OcrJobTemplate_userId_updatedAt_idx" ON "OcrJobTemplate"("userId", "updatedAt" DESC);
CREATE UNIQUE INDEX "OcrJobTemplate_userId_name_key" ON "OcrJobTemplate"("userId", "name");

CREATE INDEX "WatchedS3Source_userId_active_idx" ON "WatchedS3Source"("userId", "active");
CREATE UNIQUE INDEX "WatchedS3Source_userId_name_key" ON "WatchedS3Source"("userId", "name");

CREATE INDEX "WatchedS3Object_sourceId_ingestedAt_idx" ON "WatchedS3Object"("sourceId", "ingestedAt" DESC);
CREATE UNIQUE INDEX "WatchedS3Object_sourceId_key_key" ON "WatchedS3Object"("sourceId", "key");

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE INDEX "OcrJob_comparisonId_idx" ON "OcrJob"("comparisonId");
CREATE INDEX "OcrJob_status_nextRetryAt_idx" ON "OcrJob"("status", "nextRetryAt");
