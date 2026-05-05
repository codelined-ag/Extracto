import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { downloadOneDriveFile } from "@/lib/integrations/onedrive";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import { getApiSettings } from "@/lib/ocr/settings-store";
import { getClientIpAddress } from "@/lib/request-security";

const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
const ACCEPTED_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const POST = withMutationAuth("ocr:submit", async (request: NextRequest, { auth }) => {
  const limited = await enforceOcrSubmitRateLimit(auth, getClientIpAddress(request));
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") throw new ApiRouteError("Invalid JSON payload", 400);
  const body = raw as Record<string, unknown>;
  const fileId = typeof body.fileId === "string" ? body.fileId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!fileId) throw new ApiRouteError("fileId is required", 400);
  if (!model) throw new ApiRouteError("model is required", 400);

  const downloaded = await downloadOneDriveFile(auth.userId, fileId);
  if (downloaded.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ApiRouteError(
      `OneDrive file is too large (${Math.round(downloaded.bytes.byteLength / (1024 * 1024))} MiB > ${MAX_IMPORT_BYTES / (1024 * 1024)} MiB)`,
      413,
    );
  }
  const mime = downloaded.contentType.split(";")[0].trim().toLowerCase();
  if (!ACCEPTED_MIMES.has(mime)) {
    throw new ApiRouteError(`Unsupported file type from OneDrive: ${mime}`, 415);
  }
  const dataUrl = `data:${mime};base64,${downloaded.bytes.toString("base64")}`;

  const preloadedSettings = await getApiSettings(auth.userId);
  const apiKeyId = auth.method === "api-key" ? auth.apiKeyId ?? null : null;
  const inputs = await resolveOcrJobInputs({ userId: auth.userId, model, preloadedSettings });
  const batchId = `batch_${randomBytes(8).toString("hex")}`;
  const { jobId } = await submitOcrJob({
    ...inputs,
    userId: auth.userId,
    apiKeyId,
    fileName: downloaded.name,
    model,
    inputPreviews: [dataUrl],
    sourcePreview: dataUrl,
    sourcePdf: mime === "application/pdf" ? dataUrl : undefined,
    batchId,
  });
  return NextResponse.json({ jobId, batchId, fileName: downloaded.name, size: downloaded.bytes.byteLength });
});
