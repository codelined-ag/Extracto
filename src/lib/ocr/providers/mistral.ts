// Mistral OCR + post-processing runner.
//
// Self-contained: takes the raw apiEndpoint string the user persisted, runs
// it through endpoint policy + Mistral-specific normalization, then issues
// the HTTP calls. The OCR endpoint candidate list (with /process suffix
// fallback) is computed inside this module since it's Mistral-specific URL
// shape logic, not a route concern.

import { ApiRouteError, errorMessage } from "@/lib/api-error";
import { enforceProviderEndpointPolicy } from "@/lib/ocr/endpoint-policy";
import { parseServiceError } from "@/lib/ocr/error-parsing";
import { normalizeMistralEndpoint as normalizeMistralEndpointBase } from "@/lib/ocr/provider-normalization";
import {
  getDefaultMistralApiUrl,
  getDefaultMistralModels,
  getDefaultMistralOcrModel,
} from "@/lib/ocr/provider-config";

export function normalizeMistralApiBase(rawEndpoint: string): string {
  return normalizeMistralEndpointBase(rawEndpoint, getDefaultMistralApiUrl());
}
import {
  extractChatContentText,
  fetchWithTimeout,
  OcrStopRequestedError,
  parseResponseText,
  REQUEST_TIMEOUT_MS,
  type OcrRunResult,
  type PostProcessResult,
} from "@/lib/ocr/providers/shared";
import type { PostProcessOutputFormat } from "@/lib/ocr/settings";

interface OcrPage {
  index?: number;
  markdown?: string;
  text?: string;
  html?: string;
}

export function buildMistralOcrEndpointCandidates(rawEndpoint: string): string[] {
  const baseEndpoint = normalizeMistralApiBase(rawEndpoint);
  const withoutProcess = baseEndpoint.replace(/\/process$/iu, "");
  const withProcess = withoutProcess.endsWith("/ocr")
    ? `${withoutProcess}/process`
    : `${withoutProcess}/ocr/process`;
  const candidates = Array.from(new Set([withoutProcess, withProcess]));
  return candidates
    .map((candidate) => {
      try {
        return enforceProviderEndpointPolicy("mistral", candidate, getDefaultMistralApiUrl());
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function buildMistralChatEndpoint(rawEndpoint: string): string {
  const fallback = "https://api.mistral.ai/v1/chat/completions";
  const trimmed = rawEndpoint.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return fallback;
  }

  try {
    const url = new URL(trimmed);
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/u, "");

    if (pathname.endsWith("/chat/completions")) {
      return url.toString();
    }
    if (pathname.endsWith("/v1/ocr")) {
      url.pathname = `${pathname.slice(0, -4)}/chat/completions`;
      return url.toString();
    }
    if (pathname.endsWith("/ocr")) {
      url.pathname = `${pathname.slice(0, -4)}/v1/chat/completions`;
      return url.toString();
    }
    if (pathname.endsWith("/v1")) {
      url.pathname = `${pathname}/chat/completions`;
      return url.toString();
    }

    url.pathname = pathname ? `${pathname}/v1/chat/completions` : "/v1/chat/completions";
    return url.toString();
  } catch {
    return fallback;
  }
}

export function isLikelyMistralOcrModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes("ocr");
}

export function resolveMistralOcrModel(selectedModel: string): string {
  return isLikelyMistralOcrModel(selectedModel) ? selectedModel : getDefaultMistralOcrModel();
}

export function listMistralModels(): string[] {
  return [...new Set(getDefaultMistralModels())];
}

export async function runMistralOcr(
  apiEndpoint: string,
  model: string,
  apiKey: string,
  preview: string,
  signal?: AbortSignal,
): Promise<OcrRunResult> {
  if (!apiKey) {
    throw new ApiRouteError("MISTRAL_API_KEY is not configured", 500);
  }

  const endpointCandidates = buildMistralOcrEndpointCandidates(
    apiEndpoint || getDefaultMistralApiUrl(),
  );
  let endpointUsed = endpointCandidates[0]
    || normalizeMistralApiBase(getDefaultMistralApiUrl());
  let payload: unknown = null;
  let response: Response | null = null;
  let lastError: ApiRouteError | null = null;

  for (let index = 0; index < endpointCandidates.length; index++) {
    const candidateEndpoint = endpointCandidates[index];
    endpointUsed = candidateEndpoint;
    let candidateResponse: Response;
    try {
      candidateResponse = await fetchWithTimeout(
        candidateEndpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            document: {
              type: "image_url",
              image_url: preview,
            },
            table_format: "markdown",
          }),
        },
        REQUEST_TIMEOUT_MS,
        signal,
      );
    } catch (error) {
      if (error instanceof OcrStopRequestedError) {
        throw error;
      }
      throw error instanceof ApiRouteError
        ? error
        : new ApiRouteError(
            errorMessage(error, "Mistral OCR request failed"),
            502,
          );
    }

    const candidatePayload = await parseResponseText(candidateResponse);
    if (!candidateResponse.ok) {
      const isLastEndpoint = index === endpointCandidates.length - 1;
      const isNotFound = candidateResponse.status === 404;
      if (!isLastEndpoint && isNotFound) {
        continue;
      }

      lastError = new ApiRouteError(
        `Mistral OCR failed (${candidateResponse.status}): ${parseServiceError(
          candidateResponse,
          candidatePayload,
        )}`,
        candidateResponse.status,
      );
      break;
    }

    response = candidateResponse;
    payload = candidatePayload;
    break;
  }

  if (lastError) {
    throw lastError;
  }

  if (!response || !payload || typeof payload !== "object") {
    throw new ApiRouteError("Invalid OCR response from Mistral", 502);
  }

  const payloadObject = payload as {
    pages?: OcrPage[];
    text?: string;
    markdown?: string;
    document_annotation?: string | Record<string, unknown>;
    usage_info?: Record<string, unknown>;
  };
  const pageTexts = Array.isArray(payloadObject.pages)
    ? payloadObject.pages
        .map((page) => {
          if (typeof page.markdown === "string" && page.markdown.trim()) {
            return page.markdown.trim();
          }
          if (typeof page.text === "string" && page.text.trim()) {
            return page.text.trim();
          }
          if (typeof page.html === "string" && page.html.trim()) {
            return page.html.trim();
          }
          return "";
        })
        .filter(Boolean)
    : [];

  const text = (
    pageTexts.join("\n\n") ||
    (typeof payloadObject.text === "string" ? payloadObject.text : "") ||
    (typeof payloadObject.markdown === "string" ? payloadObject.markdown : "")
  ).trim();

  if (!text) {
    throw new ApiRouteError("Mistral returned no OCR text", 502);
  }

  const pagePayload = Array.isArray(payloadObject.pages)
    ? payloadObject.pages.map((page) => ({
        index: typeof page.index === "number" ? page.index : undefined,
        markdown: typeof page.markdown === "string" ? page.markdown : undefined,
        text: typeof page.text === "string" ? page.text : undefined,
        html: typeof page.html === "string" ? page.html : undefined,
      }))
    : [];
  const structured = {
    markdown: text,
    pages: pagePayload,
    document_annotation: payloadObject.document_annotation ?? null,
    usage_info: payloadObject.usage_info ?? null,
  };

  return {
    text,
    structured,
    metadata: {
      responsePages: Array.isArray(payloadObject.pages) ? payloadObject.pages.length : 0,
      documentAnnotation:
        typeof payloadObject.document_annotation === "string"
          ? payloadObject.document_annotation
          : payloadObject.document_annotation
            ? JSON.stringify(payloadObject.document_annotation)
            : undefined,
      usageInfo: payloadObject.usage_info,
      pages:
        Array.isArray(payloadObject.pages) && payloadObject.pages.length
          ? payloadObject.pages
              .map((page) => page.index)
              .filter((index): index is number => typeof index === "number")
          : undefined,
      endpoint: endpointUsed,
    },
  };
}

export async function runMistralPostProcessing(
  apiEndpoint: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat,
): Promise<PostProcessResult> {
  if (!apiKey) {
    throw new ApiRouteError("MISTRAL_API_KEY is not configured", 500);
  }

  const endpoint = enforceProviderEndpointPolicy(
    "mistral",
    buildMistralChatEndpoint(apiEndpoint.trim() || getDefaultMistralApiUrl()),
    getDefaultMistralApiUrl(),
  );
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(outputFormat === "json"
        ? {
            response_format: {
              type: "json_object",
            },
          }
        : {}),
      temperature: 0,
      stream: false,
    }),
  });

  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `Mistral post-processing failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status,
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Invalid post-processing response from Mistral", 502);
  }

  const firstChoice = Array.isArray((payload as { choices?: unknown[] }).choices)
    ? ((payload as { choices: Array<{ message?: { content?: unknown } }> }).choices[0]?.message)
    : undefined;
  const text = extractChatContentText(firstChoice?.content);

  if (!text) {
    throw new ApiRouteError("Mistral post-processing returned empty output", 502);
  }

  return {
    text,
    metadata: {
      endpoint,
    },
  };
}
