import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { downloadDropboxFile } from "@/lib/integrations/dropbox";
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
  if (!raw || typeof raw !== "object") {
    throw new ApiRouteError("Invalid JSON payload", 400);
  }
  const body = raw as Record<string, unknown>;
  const path = typeof body.path === "string" ? body.path.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!path) throw new ApiRouteError("path is required", 400);
  if (!model) throw new ApiRouteError("model is required", 400);

  const downloaded = await downloadDropboxFile(auth.userId, path);
  if (downloaded.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ApiRouteError(
      `Dropbox file is too large (${Math.round(downloaded.bytes.byteLength / (1024 * 1024))} MiB > ${MAX_IMPORT_BYTES / (1024 * 1024)} MiB)`,
      413,
    );
  }
  const mime = inferMime(downloaded.contentType, downloaded.name);
  if (!ACCEPTED_MIMES.has(mime)) {
    throw new ApiRouteError(`Unsupported file type from Dropbox: ${mime}`, 415);
  }
  const dataUrl = `data:${mime};base64,${downloaded.bytes.toString("base64")}`;

  const preloadedSettings = await getApiSettings(auth.userId);
  const apiKeyId = auth.method === "api-key" ? auth.apiKeyId ?? null : null;
  const inputs = await resolveOcrJobInputs({
    userId: auth.userId,
    model,
    preloadedSettings,
  });
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

function inferMime(contentType: string, name: string): string {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return ct;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}
