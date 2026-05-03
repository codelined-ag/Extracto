-- AlterTable
ALTER TABLE "OcrSetting" ADD COLUMN "preferTextLayer" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OcrSetting" ADD COLUMN "documentPreset" TEXT NOT NULL DEFAULT 'generic';
