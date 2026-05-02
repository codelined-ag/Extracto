-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '["*"]',
    "rateLimitPerMinute" INTEGER,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "requestsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "monthlyResetAt" DATETIME,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT NOT NULL DEFAULT '["job.completed","job.failed"]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFiredAt" DATETIME,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webhook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutputPreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL DEFAULT 'markdown',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OutputPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OcrSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'auto',
    "tableDetection" BOOLEAN NOT NULL DEFAULT true,
    "handwritingRecognition" BOOLEAN NOT NULL DEFAULT false,
    "preserveFormatting" BOOLEAN NOT NULL DEFAULT true,
    "customPrompt" TEXT NOT NULL DEFAULT '',
    "quality" INTEGER NOT NULL DEFAULT 80,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OcrSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OcrJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "apiKeyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT NOT NULL,
    "sourcePreview" TEXT,
    "model" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "tableDetection" BOOLEAN NOT NULL,
    "handwritingRecognition" BOOLEAN NOT NULL,
    "preserveFormatting" BOOLEAN NOT NULL,
    "customPrompt" TEXT NOT NULL,
    "quality" INTEGER NOT NULL,
    "settingsId" TEXT,
    "settingsSnapshot" JSONB NOT NULL,
    "prompt" TEXT NOT NULL,
    "extractedText" TEXT,
    "extractedTextLocation" TEXT,
    "result" JSONB,
    "resultLocation" TEXT,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "stopRequestedAt" DATETIME,
    "batchId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "processingMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OcrJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OcrJob_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "OcrSetting" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_email_key" ON "AuthUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_createdAt_idx" ON "ApiKey"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "Webhook_userId_createdAt_idx" ON "Webhook"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OutputPreset_userId_createdAt_idx" ON "OutputPreset"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OcrSetting_userId_idx" ON "OcrSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OcrSetting_userId_key_key" ON "OcrSetting"("userId", "key");

-- CreateIndex
CREATE INDEX "OcrJob_status_priority_createdAt_idx" ON "OcrJob"("status", "priority" DESC, "createdAt");

-- CreateIndex
CREATE INDEX "OcrJob_status_createdAt_idx" ON "OcrJob"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OcrJob_createdAt_idx" ON "OcrJob"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "OcrJob_settingsId_idx" ON "OcrJob"("settingsId");

-- CreateIndex
CREATE INDEX "OcrJob_userId_createdAt_idx" ON "OcrJob"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OcrJob_batchId_idx" ON "OcrJob"("batchId");

