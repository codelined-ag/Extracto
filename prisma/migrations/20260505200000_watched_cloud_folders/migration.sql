CREATE TABLE "WatchedCloudFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL DEFAULT '',
    "intervalSeconds" INTEGER NOT NULL DEFAULT 300,
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
    CONSTRAINT "WatchedCloudFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WatchedCloudObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rev" TEXT,
    "jobId" TEXT,
    "ingestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchedCloudObject_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "WatchedCloudFolder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WatchedCloudFolder_userId_provider_name_key" ON "WatchedCloudFolder"("userId", "provider", "name");
CREATE INDEX "WatchedCloudFolder_userId_active_idx" ON "WatchedCloudFolder"("userId", "active");
CREATE UNIQUE INDEX "WatchedCloudObject_sourceId_remoteId_key" ON "WatchedCloudObject"("sourceId", "remoteId");
CREATE INDEX "WatchedCloudObject_sourceId_ingestedAt_idx" ON "WatchedCloudObject"("sourceId", "ingestedAt" DESC);
