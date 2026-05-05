ALTER TABLE "AuthUser" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "passwordResetExpiresAt" DATETIME;
