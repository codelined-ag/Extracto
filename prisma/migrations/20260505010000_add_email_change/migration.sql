ALTER TABLE "AuthUser" ADD COLUMN "pendingEmail" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "emailChangeTokenHash" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "emailChangeExpiresAt" DATETIME;
