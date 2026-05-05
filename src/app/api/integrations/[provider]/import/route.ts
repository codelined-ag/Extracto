import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { downloadCloudFile, isCloudProvider } from "@/lib/integrations/dispatch";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import { getApiSettings } from "@/lib/ocr/settings-store";
import { getClientIpAddress } from "@/lib/request-security";

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const ACCEPTED_MIMES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

interface ImportBody extends Record<string, unknown> {
  remoteId?: unknown;
  path?: unknown;
  fileId?: unknown;
  model?: unknown;
}

export const POST = withSessionAuth<{ provider: string }>(
  "mutation",
  "Integration import",
  async (request: NextRequest, { params, auth }) => {
    const { provider } = await params;
    if (!isCloudProvider(provider)) throw new ApiRouteError("Unknown provider", 400);

    const limited = await enforceOcrSubmitRateLimit(auth, getClientIpAddress(request));
    if (limited) return limited;

    const body = await parseJsonBody<ImportBody>(request);
    const remoteId =
      typeof body.remoteId === "string" && body.remoteId.trim()
        ? body.remoteId.trim()
        : typeof body.path === "string" && body.path.trim()
          ? body.path.trim()
          : typeof body.fileId === "string" && body.fileId.trim()
            ? body.fileId.trim()
            : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!remoteId) throw new ApiRouteError("remoteId is required", 400);
    if (!model) throw new ApiRouteError("model is required", 400);

    const downloaded = await downloadCloudFile(provider, auth.userId, remoteId);
    if (downloaded.data.byteLength > MAX_IMPORT_BYTES) {
      throw new ApiRouteError(
        `Cloud file is too large (${Math.round(downloaded.data.byteLength / (1024 * 1024))} MiB > ${MAX_IMPORT_BYTES / (1024 * 1024)} MiB)`,
        413,
      );
    }
    const mime = inferMime(downloaded.contentType, downloaded.name);
    if (!ACCEPTED_MIMES.has(mime)) {
      throw new ApiRouteError(`Unsupported file type from ${provider}: ${mime}`, 415);
    }
    const base64 = Buffer.from(downloaded.data).toString("base64");
    const dataUrl = `data:${mime};base64,${base64}`;

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
    return NextResponse.json({
      jobId,
      batchId,
      fileName: downloaded.name,
      size: downloaded.data.byteLength,
    });
  },
);

function inferMime(contentType: string | null, name: string): string {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return ct;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}
