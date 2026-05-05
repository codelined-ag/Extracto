ALTER TABLE "AuthUser" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "AuthUser" ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AuthUser" ADD COLUMN "totpRecoveryCodesHash" JSONB;
