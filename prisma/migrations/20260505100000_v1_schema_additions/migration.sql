-- v1.0.0 schema additions
-- Add E2E public-key columns to AuthUser
ALTER TABLE "AuthUser" ADD COLUMN "e2ePublicKeyPem" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "e2ePublicKeyFingerprint" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "e2ePublicKeyRegisteredAt" DATETIME;

-- Add piiRedaction toggle to OcrSetting
ALTER TABLE "OcrSetting" ADD COLUMN "piiRedaction" BOOLEAN NOT NULL DEFAULT false;

-- IntegrationConnection table for cloud-drive OAuth (Dropbox, Google Drive, OneDrive)
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "clientIdLast4" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IntegrationConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AuthUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntegrationConnection_userId_provider_key" ON "IntegrationConnection"("userId", "provider");
CREATE INDEX "IntegrationConnection_userId_idx" ON "IntegrationConnection"("userId");
