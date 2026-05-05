import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { normalizeProvider, type ProviderKind } from "@/lib/api-types";
import { withMutationAuth } from "@/lib/auth/request";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import {
  computeBreakdown,
  DEFAULT_INPUT_TOKENS_PER_PAGE,
  DEFAULT_OUTPUT_TOKENS_PER_PAGE,
  DEFAULT_POST_PROCESSING_OUTPUT_TOKENS_PER_PAGE,
  resolveModelPricing,
} from "@/lib/pricing";
import { getApiSettings } from "@/lib/ocr/settings-store";
import type {
  OcrCostBreakdown,
  OcrEstimateFile,
  OcrEstimateRequest,
  OcrEstimateResponse,
} from "@/lib/pricing/types";

const MAX_FILES = 200;
const MAX_PAGES_PER_FILE = 5000;

function parseBody(raw: unknown): OcrEstimateRequest {
  if (!raw || typeof raw !== "object") {
    throw new ApiRouteError("Invalid JSON payload", 400);
  }
  const body = raw as Record<string, unknown>;
  const filesRaw = body.files;
  if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
    throw new ApiRouteError("files must be a non-empty array", 400);
  }
  if (filesRaw.length > MAX_FILES) {
    throw new ApiRouteError(`Maximum of ${MAX_FILES} files per estimate`, 400);
  }
  const files: OcrEstimateRequest["files"] = filesRaw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ApiRouteError(`files[${index}] must be an object`, 400);
    }
    const f = entry as Record<string, unknown>;
    const pageCount = typeof f.pageCount === "number" ? Math.trunc(f.pageCount) : NaN;
    if (!Number.isFinite(pageCount) || pageCount < 1) {
      throw new ApiRouteError(`files[${index}].pageCount must be a positive integer`, 400);
    }
    if (pageCount > MAX_PAGES_PER_FILE) {
      throw new ApiRouteError(`files[${index}].pageCount exceeds ${MAX_PAGES_PER_FILE}`, 400);
    }
    const fileName = typeof f.fileName === "string" ? f.fileName.trim() : undefined;
    return { pageCount, fileName };
  });

  const VALID_PROVIDERS: ReadonlySet<ProviderKind> = new Set([
    "ollama",
    "mistral",
    "openrouter",
    "openai_compat",
  ]);
  let provider: ProviderKind | undefined;
  if (typeof body.provider === "string") {
    if (!VALID_PROVIDERS.has(body.provider as ProviderKind)) {
      throw new ApiRouteError(`provider must be one of ${[...VALID_PROVIDERS].join(", ")}`, 400);
    }
    provider = body.provider as ProviderKind;
  }
  const model = typeof body.model === "string" ? body.model.trim() : undefined;
  const apiEndpoint = typeof body.apiEndpoint === "string" ? body.apiEndpoint.trim() : undefined;

  const pp = body.postProcessing && typeof body.postProcessing === "object"
    ? (body.postProcessing as Record<string, unknown>)
    : undefined;
  const ppFormat: "markdown" | "json" | undefined =
    pp?.outputFormat === "json" || pp?.outputFormat === "markdown" ? pp.outputFormat : undefined;
  const postProcessing: OcrEstimateRequest["postProcessing"] = pp
    ? {
        enabled: typeof pp.enabled === "boolean" ? pp.enabled : false,
        model: typeof pp.model === "string" ? pp.model.trim() : undefined,
        outputFormat: ppFormat,
      }
    : undefined;

  const outputTokensPerPage =
    typeof body.outputTokensPerPage === "number" && Number.isFinite(body.outputTokensPerPage) && body.outputTokensPerPage >= 0
      ? Math.trunc(body.outputTokensPerPage)
      : undefined;
  const inputTokensPerPage =
    typeof body.inputTokensPerPage === "number" && Number.isFinite(body.inputTokensPerPage) && body.inputTokensPerPage >= 0
      ? Math.trunc(body.inputTokensPerPage)
      : undefined;

  return { files, provider, model, apiEndpoint, postProcessing, outputTokensPerPage, inputTokensPerPage };
}

export const POST = withMutationAuth("ocr:submit", async (request: NextRequest, { auth }) => {
  const limited = await enforceOcrSubmitRateLimit(auth, getClientIpAddress(request));
  if (limited) return limited;

  const raw = await request.json().catch(() => null);
  const body = parseBody(raw);

  const stored = await getApiSettings(auth.userId);
  const provider = body.provider ? normalizeProvider(body.provider) : stored.provider;
  const apiEndpoint = body.apiEndpoint ?? stored.apiEndpoint;
  const ocrModel = body.model ?? "";
  if (!ocrModel) {
    throw new ApiRouteError("model is required for cost estimation", 400);
  }

  const totalPages = body.files.reduce((sum, f) => sum + f.pageCount, 0);
  const outputTokensPerPage = body.outputTokensPerPage ?? DEFAULT_OUTPUT_TOKENS_PER_PAGE;
  const inputTokensPerPage = body.inputTokensPerPage ?? DEFAULT_INPUT_TOKENS_PER_PAGE;

  const ocrPricing = await resolveModelPricing(provider, ocrModel, apiEndpoint);
  const ocrBreakdown = computeBreakdown(
    {
      provider,
      apiEndpoint,
      model: ocrModel,
      pageCount: totalPages,
      inputTokensPerPage,
      outputTokensPerPage,
    },
    ocrPricing,
  );

  let postProcessingBreakdown: OcrCostBreakdown | null = null;
  if (body.postProcessing?.enabled && body.postProcessing.model) {
    const ppPricing = await resolveModelPricing(provider, body.postProcessing.model, apiEndpoint);
    const ppOutputTokens = DEFAULT_POST_PROCESSING_OUTPUT_TOKENS_PER_PAGE;
    postProcessingBreakdown = computeBreakdown(
      {
        provider,
        apiEndpoint,
        model: body.postProcessing.model,
        pageCount: totalPages,
        inputTokensPerPage: outputTokensPerPage,
        outputTokensPerPage: ppOutputTokens,
      },
      ppPricing,
    );
  }

  const filesOut: OcrEstimateFile[] = body.files.map((f) => ({
    fileName: f.fileName,
    pageCount: f.pageCount,
    cost: computeBreakdown(
      {
        provider,
        apiEndpoint,
        model: ocrModel,
        pageCount: f.pageCount,
        inputTokensPerPage,
        outputTokensPerPage,
      },
      ocrPricing,
    ),
  }));

  const total = round6(ocrBreakdown.totalCost + (postProcessingBreakdown?.totalCost ?? 0));
  const perPage = totalPages > 0 ? round6(total / totalPages) : 0;

  const warnings = collectWarnings(ocrBreakdown, postProcessingBreakdown);

  const response: OcrEstimateResponse = {
    currency: "USD",
    totalPages,
    total,
    perPage,
    ocr: ocrBreakdown,
    postProcessing: postProcessingBreakdown,
    files: filesOut,
    assumptions: {
      outputTokensPerPage,
      inputTokensPerPage,
      postProcessingOutputTokensPerPage: DEFAULT_POST_PROCESSING_OUTPUT_TOKENS_PER_PAGE,
    },
    warnings,
  };
  return NextResponse.json(response);
});

function collectWarnings(
  ocr: OcrCostBreakdown,
  pp: OcrCostBreakdown | null,
): string[] {
  const warnings = new Set<string>();
  for (const w of ocr.pricing.warnings) warnings.add(w);
  if (pp) {
    for (const w of pp.pricing.warnings) warnings.add(w);
  }
  return [...warnings];
}

function round6(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}
