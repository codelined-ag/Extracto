import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import { ApiProviderSettings, FALLBACK_OLLAMA_HOST, getApiSettings } from "@/lib/settings-store";
import { normalizeMistralEndpoint as normalizeMistralEndpointBase } from "@/lib/ocr/provider-normalization";
import { getStringField, parsePreviewImageData, parseServiceError } from "@/lib/ocr/error-parsing";
import {
  extractChatContentText,
  fetchWithTimeout,
  normalizeStructuredMarkdownPayload,
  OcrStopRequestedError,
  parseResponseText,
  REQUEST_TIMEOUT_MS,
  type OcrRunResult,
  type PostProcessResult,
} from "@/lib/ocr/providers/shared";
import {
  buildMistralChatEndpoint,
  buildMistralOcrEndpointCandidates,
  isLikelyMistralOcrModel,
  listMistralModels,
  resolveMistralOcrModel,
  runMistralOcr,
  runMistralPostProcessing,
} from "@/lib/ocr/providers/mistral";
import {
  buildCompatEndpoint,
  type CompatProviderConfig,
  discoverCompatModels,
  normalizeOpenAICompatApiBase,
  normalizeOpenRouterApiBase,
  OPENAI_COMPAT_CONFIG,
  OPENROUTER_CONFIG,
  runCompatOcr,
  runCompatPostProcessing,
} from "@/lib/ocr/providers/compat";
import {
  runOllamaOcr as runOllamaOcrIter,
  runOllamaPostProcessing as runOllamaPostProcessingIter,
  unloadOllamaModel as unloadOllamaModelIter,
  warmupOllamaModel as warmupOllamaModelIter,
} from "@/lib/ocr/providers/ollama";
import {
  appendPageMarkdown,
  coerceMarkdownText,
  extractStructuredPageEntryMarkdown,
  getPageMarkdownForRouting,
  parseJsonCandidate,
} from "@/lib/ocr/markdown-routing";
import {
  seedExtractedText,
  seedPostProcessingMeta,
  seedUsedOllamaModels,
} from "@/lib/ocr/job-seed";
import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
import {
  maybeUploadResultJson,
  maybeUploadResultText,
} from "@/lib/result-store";
import { dispatchJobWebhooks } from "@/lib/background/webhooks";
import { db } from "@/lib/db";
import { enforceProviderEndpointPolicy, normalizeProvider, ProviderKind } from "@/lib/endpoint-policy";
import {
  clearOcrJobRunning,
  clearOcrJobStop,
  isOcrJobStopRequested,
  markOcrJobRunning,
  registerOcrJobAbortController,
  unregisterOcrJobAbortController,
  withOcrJobSlot,
} from "@/lib/ocr/job-control";
import {
  buildOllamaHostCandidates,
  normalizeHostEndpoint,
  resolveOllamaHostEndpoint,
} from "@/lib/host-normalization";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import { AdvancedSettings, normalizeAdvancedSettings, PostProcessingSettings, PostProcessOutputFormat } from "@/lib/ocr/settings";
import { ApiRouteError, handleApiError, pipelineStatusFor } from "@/lib/api-error";
import { extractFirstBalancedJsonObject, extractMarkdownFromJsonLikeText } from "@/lib/ocr/text-extract";
import {
  DEFAULT_MISTRAL_API_URL,
  DEFAULT_MISTRAL_MODELS,
  DEFAULT_MISTRAL_OCR_MODEL,
  DEFAULT_OPENAI_COMPAT_API_URL,
  DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS,
  DEFAULT_OPENROUTER_API_URL,
  DEFAULT_OPENROUTER_FALLBACK_MODELS,
  OLLAMA_DEFAULT_HOST,
  OLLAMA_DISCOVERY_PATHS,
  OLLAMA_NETWORK_HINT,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
} from "@/lib/ocr/provider-config";

const normalizeMistralEndpoint = (raw: string) =>
  normalizeMistralEndpointBase(raw, DEFAULT_MISTRAL_API_URL);

interface OCRRequestBody {
  jobId?: unknown;
  resume?: unknown;
  fileName?: unknown;
  model?: unknown;
  preview?: unknown;
  pages?: unknown;
  priority?: unknown;
  batchId?: unknown;
  settings?: Partial<AdvancedSettings>;
  postProcessing?: Partial<PostProcessingSettings>;
}

function parseRequestPriority(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-10, Math.min(10, Math.trunc(value)));
}

interface OcrPage {
  index?: number;
  markdown?: string;
  text?: string;
  html?: string;
}

interface ModelCatalog {
  ollama: string[];
  mistral: string[];
  openrouter: string[];
  openai_compat: string[];
}

interface OcrJsonResult {
  fileName: string;
  extractedAt: string;
  provider: ProviderKind;
  model: string;
  settings: AdvancedSettings;
  text: string;
  markdown: string;
  structured: Record<string, unknown>;
  metadata: {
    characterCount: number;
    wordCount: number;
    lineCount: number;
    provider: ProviderKind;
    [key: string]: unknown;
  };
  rawExtractionText?: string;
  postProcessedText?: string;
}

type OcrProgressStage =
  | "queued"
  | "analyzing"
  | "ocr"
  | "post_processing"
  | "exporting"
  | "finalizing"
  | "paused"
  | "completed"
  | "failed";

interface OcrProgressEvent {
  at: string;
  stage: OcrProgressStage;
  message: string;
}

interface OcrPageCheckpoint {
  pageNumber: number;
  status: "completed";
  characterCount: number;
  durationMs: number;
  previewText: string;
}

interface OcrProgressMetadata {
  stage: OcrProgressStage;
  message: string;
  progressPct: number;
  pageCount: number;
  processedPages: number;
  currentPage: number | null;
  etaSeconds: number | null;
  startedAt: string;
  updatedAt: string;
  events: OcrProgressEvent[];
  checkpoints: OcrPageCheckpoint[];
  postProcessing: {
    enabled: boolean;
    applied?: boolean;
    outputFormat?: PostProcessOutputFormat;
    instruction?: string;
    model?: string;
    provider?: ProviderKind;
    error?: string;
  };
}



const APP_NETWORK_MODE = (process.env.APP_NETWORK_MODE || "bridge").trim().toLowerCase();

const OLLAMA_MODEL_CACHE_TTL_MS = 60_000;
const MAX_STORED_PREVIEW_LENGTH = 1_500_000;
const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;
const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
const OCR_RATE_LIMIT_MAX = 6;
const OLLAMA_DISCOVERY_FALLBACK_HOST =
  APP_NETWORK_MODE === "host" ? OLLAMA_DEFAULT_HOST : FALLBACK_OLLAMA_HOST;

let ollamaModelCache: {
  values: string[];
  expiresAt: number;
  host: string;
} = {
  values: [],
  expiresAt: 0,
  host: "",
};

interface OllamaModelCatalogResult {
  models: string[];
  host: string;
}

function getOllamaHostCandidates(rawEndpoint: string): string[] {
  const rawCandidates = buildOllamaHostCandidates(rawEndpoint, OLLAMA_DISCOVERY_FALLBACK_HOST);
  const safeCandidates = rawCandidates
    .map((candidate) => {
      try {
        return enforceProviderEndpointPolicy("ollama", candidate, OLLAMA_DISCOVERY_FALLBACK_HOST);
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return safeCandidates.length > 0
    ? Array.from(new Set(safeCandidates))
    : [enforceProviderEndpointPolicy("ollama", rawEndpoint, OLLAMA_DISCOVERY_FALLBACK_HOST)];
}

function normalizeOllamaApiBase(rawEndpoint: string): string {
  return normalizeHostEndpoint(rawEndpoint, OLLAMA_DISCOVERY_FALLBACK_HOST)
    .replace(/\/api\/?$/i, "")
    .replace(/\/v1\/?$/i, "");
}

function getCachedOllamaHost(endpoint: string): string | null {
  const now = Date.now();
  if (!ollamaModelCache.host) {
    return null;
  }
  if (ollamaModelCache.expiresAt <= now || !ollamaModelCache.values.length) {
    return null;
  }
  const candidates = getOllamaHostCandidates(endpoint).map(resolveOllamaRuntimeEndpoint);
  if (candidates.includes(ollamaModelCache.host)) {
    return ollamaModelCache.host;
  }
  return null;
}

function setOllamaModelCache(host: string, values: string[]) {
  ollamaModelCache = {
    values,
    host,
    expiresAt: Date.now() + OLLAMA_MODEL_CACHE_TTL_MS,
  };
}

function getOllamaCandidatesForOcr(endpoint: string): string[] {
  const candidates = getOllamaHostCandidates(endpoint).map(normalizeOllamaApiBase);
  const normalizedFallback = normalizeOllamaApiBase(OLLAMA_DISCOVERY_FALLBACK_HOST);
  if (!candidates.includes(normalizedFallback)) {
    candidates.push(normalizedFallback);
  }
  return Array.from(new Set(candidates));
}


function normalizePreviewForHistory(preview: string): string | null {
  const trimmed = preview.trim();
  if (!trimmed.startsWith("data:image/")) {
    return null;
  }
  if (trimmed.length > MAX_STORED_PREVIEW_LENGTH) {
    return null;
  }
  return trimmed;
}

function normalizeProviderEndpoint(provider: ProviderKind, rawEndpoint: string): string {
  if (provider === "mistral") {
    return enforceProviderEndpointPolicy("mistral",
      normalizeMistralEndpoint(rawEndpoint || DEFAULT_MISTRAL_API_URL),
      DEFAULT_MISTRAL_API_URL);
  }
  if (provider === "openrouter") {
    return enforceProviderEndpointPolicy("openrouter",
      normalizeOpenRouterApiBase(rawEndpoint || DEFAULT_OPENROUTER_API_URL),
      DEFAULT_OPENROUTER_API_URL);
  }
  if (provider === "openai_compat") {
    return enforceProviderEndpointPolicy("openai_compat",
      normalizeOpenAICompatApiBase(rawEndpoint || DEFAULT_OPENAI_COMPAT_API_URL),
      DEFAULT_OPENAI_COMPAT_API_URL);
  }
  return enforceProviderEndpointPolicy("ollama",
    resolveOllamaHostEndpoint(rawEndpoint || OLLAMA_DISCOVERY_FALLBACK_HOST, OLLAMA_DISCOVERY_FALLBACK_HOST),
    OLLAMA_DISCOVERY_FALLBACK_HOST);
}

function normalizeAndValidateApiSettings(raw: ApiProviderSettings): ApiProviderSettings {
  const provider = normalizeProvider(raw.provider);
  return {
    provider,
    apiEndpoint: normalizeProviderEndpoint(provider, raw.apiEndpoint),
    apiKey: raw.apiKey?.trim() || "",
  };
}

// Runtime normalization for OpenAI-compatible / OpenRouter base URLs lives in
// src/lib/ocr/providers/compat.ts (imported above) so the runners can be unit-tested.

function resolveOllamaRuntimeEndpoint(rawEndpoint: string): string {
  const resolvedHost = resolveOllamaHostEndpoint(
    rawEndpoint,
    OLLAMA_DISCOVERY_FALLBACK_HOST,
  );
  return normalizeHostEndpoint(resolvedHost, OLLAMA_DISCOVERY_FALLBACK_HOST)
    .replace(/\/api\/?$/i, "")
    .replace(/\/v1\/?$/i, "");
}

// buildMistralOcrEndpointCandidates moved to src/lib/ocr/providers/mistral.ts.

function sanitizePostProcessing(
  raw: Partial<PostProcessingSettings> | undefined
): PostProcessingSettings {
  const rawInstruction = typeof raw?.instruction === "string" ? raw.instruction.trim() : "";
  const outputFormat = raw?.outputFormat === "json" ? "json" : "markdown";
  const model = typeof raw?.model === "string" ? raw.model.trim() : "";
  const enabled = Boolean(raw?.enabled) && rawInstruction.length > 0;

  return {
    enabled,
    instruction: rawInstruction.slice(0, MAX_POST_PROCESS_INSTRUCTION_LENGTH),
    outputFormat,
    model,
  };
}

// isLikelyMistralOcrModel + resolveMistralOcrModel moved to src/lib/ocr/providers/mistral.ts.

// parsePreviewImageData, getStringField, parseServiceError moved to
// src/lib/ocr/error-parsing.ts (imported above) for unit testability.

function buildPrompt(settings: AdvancedSettings): string {
  const languageInstruction =
    settings.language !== "auto"
      ? `The document is in ${settings.language}. Please transcribe in that language.`
      : "Detect the document language automatically.";

  const tableInstruction = settings.tableDetection
    ? "If there are tables, format them using markdown tables with proper column alignment."
    : "Extract table content as plain text.";

  const handwritingInstruction = settings.handwritingRecognition
    ? "Pay special attention to handwritten text and do your best to transcribe it accurately."
    : "Focus on printed text only.";

  const formattingInstruction = settings.preserveFormatting
    ? "Preserve the original formatting, layout, and structure as much as possible including spacing, indentation, and alignment."
    : "Extract text in a simplified format, focusing on content over formatting.";

  const customInstruction = settings.customPrompt
    ? `\n\nAdditional instructions from user:\n${settings.customPrompt}`
    : "";

  return `You are an OCR (Optical Character Recognition) system. Extract all text from this document image.

Instructions:
1. Extract ALL text visible in the image
2. ${languageInstruction}
3. ${tableInstruction}
4. ${handwritingInstruction}
5. ${formattingInstruction}
6. Include any numbers, dates, and special characters exactly as shown
7. If text is unclear or illegible, indicate with [illegible]${customInstruction}

Quality focus: ${settings.quality}%

Return ONLY valid JSON with this exact shape:
{
  "markdown": "clean markdown text extracted from the image",
  "fields": {}
}

Rules:
- "markdown" is required and must contain the extracted OCR content.
- "fields" is optional but if present must be a JSON object.
- Do not wrap JSON in markdown code fences.`;
}

function buildPostProcessingPrompt(
  postProcessing: PostProcessingSettings
): { systemPrompt: string; userPrompt: string } {
  const outputInstruction =
    postProcessing.outputFormat === "json"
      ? "Return only valid JSON (no markdown code fences)."
      : "Return markdown only.";

  return {
    systemPrompt:
      "You are a precise post-processing assistant for OCR results. " +
      "Follow the user instruction exactly. Do not invent missing facts. " +
      "If data is missing, set fields to null or explicitly note missing values.",
    userPrompt: [
      "User instruction:",
      postProcessing.instruction,
      "",
      "Output format requirement:",
      outputInstruction,
    ].join("\n"),
  };
}

// extractStructuredPageEntryMarkdown + getPageMarkdownForRouting moved to
// src/lib/ocr/markdown-routing.ts (imported above) for unit testability.


function formatPageScopedText(
  pages: Array<{
    pageNumber: number;
    text: string;
  }>
): string {
  return pages
    .map((page) => [`[PAGE ${page.pageNumber}]`, page.text.trim(), `[END PAGE ${page.pageNumber}]`].join("\n"))
    .join("\n\n");
}

function computeTextStats(text: string) {
  const trimmed = text.trim();
  return {
    characterCount: trimmed.length,
    wordCount: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
    lineCount: trimmed ? trimmed.split("\n").filter(Boolean).length : 0,
  };
}

// extractChatContentText + normalizeStructuredMarkdownPayload moved to src/lib/ocr/providers/shared.ts.
// parseJsonCandidate + coerceMarkdownText moved to src/lib/ocr/markdown-routing.ts.

function normalizePostProcessedText(
  text: string,
  outputFormat: PostProcessOutputFormat
): { text: string; parsedJson?: unknown } {
  if (outputFormat !== "json") {
    return { text: text.trim() };
  }

  const trimmed = text.trim();
  const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  const jsonCandidate = (codeFenceMatch?.[1] || trimmed).trim();
  try {
    const parsed = JSON.parse(jsonCandidate);
    return {
      text: JSON.stringify(parsed, null, 2),
      parsedJson: parsed,
    };
  } catch {
    return {
      text: trimmed,
    };
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function appendProgressEvent(
  events: OcrProgressEvent[],
  stage: OcrProgressStage,
  message: string
): OcrProgressEvent[] {
  const nextEvents = [...events, { at: new Date().toISOString(), stage, message }];
  return nextEvents.slice(-60);
}

function buildProgressMetadata(input: {
  stage: OcrProgressStage;
  message: string;
  progressPct: number;
  pageCount: number;
  processedPages: number;
  currentPage: number | null;
  etaSeconds: number | null;
  startedAt: string;
  events: OcrProgressEvent[];
  checkpoints: OcrPageCheckpoint[];
  postProcessing: OcrProgressMetadata["postProcessing"];
}): OcrProgressMetadata {
  return {
    stage: input.stage,
    message: input.message,
    progressPct: clampProgress(input.progressPct),
    pageCount: input.pageCount,
    processedPages: input.processedPages,
    currentPage: input.currentPage,
    etaSeconds: input.etaSeconds,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
    events: input.events,
    checkpoints: input.checkpoints,
    postProcessing: input.postProcessing,
  };
}

function buildJsonResult(
  fileName: string,
  model: string,
  provider: ProviderKind,
  settings: AdvancedSettings,
  markdown: string,
  structured: Record<string, unknown>,
  metadata: Record<string, unknown> = {}
): OcrJsonResult {
  const normalizedMarkdown = markdown.trim();
  return {
    fileName,
    extractedAt: new Date().toISOString(),
    provider,
    model,
    settings,
    text: normalizedMarkdown,
    markdown: normalizedMarkdown,
    structured,
    metadata: {
      ...computeTextStats(normalizedMarkdown),
      provider,
      ...metadata,
    },
  };
}

// parseResponseText + fetchWithTimeout + OcrStopRequestedError moved to
// src/lib/ocr/providers/shared.ts.
// getStringField + parseServiceError moved to src/lib/ocr/error-parsing.ts.

async function getOllamaModels(
  endpoint: string,
): Promise<OllamaModelCatalogResult> {
  const cachedHost = getCachedOllamaHost(endpoint);
  if (cachedHost) {
    return {
      host: cachedHost,
      models: ollamaModelCache.values,
    };
  }

  const errors: string[] = [];
  const candidates = getOllamaCandidatesForOcr(endpoint);

  for (const host of candidates) {
    for (const path of OLLAMA_DISCOVERY_PATHS) {
      try {
        const response = await fetchWithTimeout(`${host}${path}`, {
          headers: {
            Accept: "application/json",
          },
        });

        const payload = await parseResponseText(response);
        if (!response.ok) {
          errors.push(
            `${host}${path}: ${response.status} ${parseServiceError(response, payload)}`
          );
          continue;
        }

        if (!payload || typeof payload !== "object") {
          errors.push(`${host}${path}: invalid Ollama model response`);
          continue;
        }

        const candidatePayload = payload as {
          models?: { name?: unknown }[];
          data?: { name?: unknown }[];
        };
        const entries = Array.isArray(candidatePayload.models)
          ? candidatePayload.models
          : Array.isArray(candidatePayload.data)
            ? candidatePayload.data
            : [];
        const values = Array.isArray(entries)
          ? entries
              .map((entry) => (typeof entry?.name === "string" ? entry.name : ""))
              .filter((value): value is string => value.length > 0)
          : [];

        if (!values.length) {
          errors.push(`${host}${path}: no models returned`);
          continue;
        }

        const uniqueValues = Array.from(new Set(values));
        setOllamaModelCache(host, uniqueValues);
        return {
          host,
          models: uniqueValues,
        };
      } catch (error) {
        errors.push(`${host}${path}: ${error instanceof Error ? error.message : "Request failed"}`);
      }
    }
  }

  throw new ApiRouteError(`No reachable Ollama host found (${errors.join(" | ")})`, 502);
}


function resolveProvider(model: string, settings: ApiProviderSettings): ProviderKind {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    throw new ApiRouteError("Model is required", 400);
  }
  return normalizeProvider(settings.provider);
}

// OcrRunResult + PostProcessResult moved to src/lib/ocr/providers/shared.ts.

interface ProviderHandler {
  envKey: string;
  runOcr: (
    settings: ApiProviderSettings,
    model: string,
    prompt: string,
    preview: string,
    apiKey: string,
    signal?: AbortSignal,
  ) => Promise<OcrRunResult>;
  runPostProcess: (
    settings: ApiProviderSettings,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    outputFormat: PostProcessOutputFormat,
  ) => Promise<PostProcessResult>;
}

// Wrap the pure host-iterating Ollama runners with route-level concerns:
// (a) resolve raw user endpoint into the actual candidate base URLs, and
// (b) on failure, augment the error with a "last reachable host" hint plus
// the network-mode hint string from provider-config.
async function runOllamaOcr(
  endpoint: string,
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal,
): Promise<OcrRunResult> {
  const hosts = getOllamaCandidatesForOcr(endpoint);
  try {
    return await runOllamaOcrIter(hosts, model, prompt, preview, signal);
  } catch (error) {
    if (error instanceof OcrStopRequestedError) throw error;
    if (error instanceof ApiRouteError) {
      let resolvedHost: string | null = null;
      try {
        resolvedHost = (await getOllamaModels(endpoint)).host;
      } catch {
        // keep fallback message context
      }
      const hint = resolvedHost
        ? `Last reachable host was ${resolvedHost}.`
        : "No reachable Ollama endpoint found.";
      throw new ApiRouteError(`${hint} ${error.message}. ${OLLAMA_NETWORK_HINT}`, error.status);
    }
    throw error;
  }
}

async function runOllamaPostProcessing(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<PostProcessResult> {
  return runOllamaPostProcessingIter(getOllamaCandidatesForOcr(endpoint), model, systemPrompt, userPrompt);
}

async function unloadOllamaModel(endpoint: string, model: string): Promise<void> {
  return unloadOllamaModelIter(getOllamaCandidatesForOcr(endpoint), model);
}

async function warmupOllamaModel(endpoint: string, model: string): Promise<void> {
  return warmupOllamaModelIter(getOllamaCandidatesForOcr(endpoint), model);
}

// Single registry of per-provider OCR + post-processing handlers. TypeScript
// enforces that every ProviderKind has an entry, so adding a new provider is
// one declaration here rather than three if-chains across the file.
const PROVIDER_HANDLERS: Record<ProviderKind, ProviderHandler> = {
  ollama: {
    envKey: "",
    runOcr: (s, m, p, pv, _k, sig) => runOllamaOcr(s.apiEndpoint, m, p, pv, sig),
    runPostProcess: (s, m, sp, up, _k, _of) =>
      runOllamaPostProcessing(s.apiEndpoint, m, sp, up),
  },
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    runOcr: (s, m, p, pv, k, sig) =>
      runCompatOcr(OPENROUTER_CONFIG, s.apiEndpoint, m, k, p, pv, sig),
    runPostProcess: (s, m, sp, up, k, of) =>
      runCompatPostProcessing(OPENROUTER_CONFIG, s.apiEndpoint, m, k, sp, up, of),
  },
  openai_compat: {
    envKey: "OPENAI_COMPAT_API_KEY",
    runOcr: (s, m, p, pv, k, sig) =>
      runCompatOcr(OPENAI_COMPAT_CONFIG, s.apiEndpoint, m, k, p, pv, sig),
    runPostProcess: (s, m, sp, up, k, of) =>
      runCompatPostProcessing(OPENAI_COMPAT_CONFIG, s.apiEndpoint, m, k, sp, up, of),
  },
  mistral: {
    envKey: "MISTRAL_API_KEY",
    runOcr: (s, m, _p, pv, k, sig) => runMistralOcr(s.apiEndpoint, m, k, pv, sig),
    runPostProcess: (s, m, sp, up, k, of) =>
      runMistralPostProcessing(s.apiEndpoint, m, k, sp, up, of),
  },
};

function resolveProviderApiKey(provider: ProviderKind, settings: ApiProviderSettings): string {
  if (settings.apiKey) return settings.apiKey;
  const envKey = PROVIDER_HANDLERS[provider].envKey;
  return envKey ? (process.env[envKey] || "") : "";
}

async function runProviderOcr(
  provider: ProviderKind,
  settings: ApiProviderSettings,
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal,
): Promise<OcrRunResult> {
  const handler = PROVIDER_HANDLERS[provider];
  return handler.runOcr(settings, model, prompt, preview, resolveProviderApiKey(provider, settings), signal);
}

async function runProviderPostProcessing(
  provider: ProviderKind,
  settings: ApiProviderSettings,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat,
): Promise<PostProcessResult> {
  const handler = PROVIDER_HANDLERS[provider];
  return handler.runPostProcess(
    settings,
    model,
    systemPrompt,
    userPrompt,
    resolveProviderApiKey(provider, settings),
    outputFormat,
  );
}

async function tryDiscover(discover: () => Promise<string[]>, label: string): Promise<string[]> {
  try {
    return await discover();
  } catch (error) {
    console.error(`Failed to fetch ${label}:`, error);
    return [];
  }
}

async function getModelCatalog(settings: ApiProviderSettings): Promise<ModelCatalog> {
  const mistralModels = listMistralModels();

  const ollamaModels = await tryDiscover(
    () => getOllamaModels(settings.apiEndpoint).then((r) => r.models),
    "Ollama model catalog"
  );

  const openRouterEndpoint =
    settings.provider === "openrouter" ? settings.apiEndpoint : DEFAULT_OPENROUTER_API_URL;
  const openRouterKey =
    settings.provider === "openrouter"
      ? settings.apiKey || process.env.OPENROUTER_API_KEY || ""
      : process.env.OPENROUTER_API_KEY || "";
  const openRouterModels = openRouterKey
    ? await tryDiscover(
        () => discoverCompatModels(OPENROUTER_CONFIG, openRouterEndpoint, openRouterKey),
        "OpenRouter model catalog"
      )
    : [];
  const resolvedOpenRouterModels =
    openRouterModels.length === 0 && settings.provider === "openrouter"
      ? [...DEFAULT_OPENROUTER_FALLBACK_MODELS]
      : openRouterModels;

  const openAICompatEndpoint =
    settings.provider === "openai_compat" ? settings.apiEndpoint : DEFAULT_OPENAI_COMPAT_API_URL;
  const openAICompatKey =
    settings.provider === "openai_compat"
      ? settings.apiKey || process.env.OPENAI_COMPAT_API_KEY || ""
      : process.env.OPENAI_COMPAT_API_KEY || "";
  const openAICompatModels = openAICompatKey
    ? await tryDiscover(
        () => discoverCompatModels(OPENAI_COMPAT_CONFIG, openAICompatEndpoint, openAICompatKey),
        "OpenAI-compatible model catalog"
      )
    : [];
  const resolvedOpenAICompatModels =
    openAICompatModels.length === 0 && settings.provider === "openai_compat"
      ? [...DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS]
      : openAICompatModels;

  return {
    ollama: ollamaModels,
    mistral: mistralModels,
    openrouter: resolvedOpenRouterModels,
    openai_compat: resolvedOpenAICompatModels,
  };
}

interface ProcessOcrJobInput {
  jobId: string;
  startedAtMs: number;
  fileName: string;
  model: string;
  ocrModel: string;
  provider: ProviderKind;
  settings: ApiProviderSettings;
  settingsPayload: AdvancedSettings;
  postProcessingPayload: PostProcessingSettings;
  inputPreviews: string[];
  prompt: string;
  initialPageOutputs?: ProcessedPageOutput[];
  startIndex?: number;
  resumed?: boolean;
}

interface ProcessedPageOutput {
  pageNumber: number;
  text: string;
  structured: Record<string, unknown>;
  metadata: Record<string, unknown>;
  durationMs: number;
}

function toPageCheckpoint(page: ProcessedPageOutput): OcrPageCheckpoint {
  return {
    pageNumber: page.pageNumber,
    status: "completed",
    characterCount: page.text.length,
    durationMs: page.durationMs,
    previewText: page.text.trim().slice(0, 320),
  };
}

function toPageRecord(page: ProcessedPageOutput) {
  return {
    pageNumber: page.pageNumber,
    text: page.text,
    structured: page.structured,
    durationMs: page.durationMs,
    metadata: page.metadata,
  };
}

function toStructuredPagePayload(page: ProcessedPageOutput) {
  return {
    pageNumber: page.pageNumber,
    durationMs: page.durationMs,
    ...page.structured,
  };
}

function toPageResultPayload(page: ProcessedPageOutput) {
  return {
    pageNumber: page.pageNumber,
    durationMs: page.durationMs,
    structured: page.structured,
    ...page.metadata,
  };
}

async function unloadAllOllamaModels(apiEndpoint: string, models: Set<string>): Promise<void> {
  for (const model of models) {
    await unloadOllamaModel(apiEndpoint, model);
  }
}

async function finalizeOcrJob(jobId: string, apiEndpoint: string, usedOllamaModels: Set<string>): Promise<void> {
  await unloadAllOllamaModels(apiEndpoint, usedOllamaModels);
  clearOcrJobRunning(jobId);
  await clearOcrJobStop(jobId);
}

/**
 * Persist a successful OCR job: offload large artifacts (text + JSON
 * result) to the result store, write the COMPLETED row, dispatch the
 * job.completed webhook, then finalize (unload Ollama models, clear
 * running/stop flags). One unit so the success-path tail of
 * processOcrJobInBackground reads as one call instead of 25 lines of
 * Prisma + side effects.
 */
async function persistCompletedJob(
  input: ProcessOcrJobInput,
  finalMarkdown: string,
  result: unknown,
  extractedMetadata: Record<string, unknown>,
  usedOllamaModels: Set<string>,
): Promise<void> {
  const [extractedTextOffload, resultOffload] = await Promise.all([
    maybeUploadResultText(input.jobId, finalMarkdown),
    maybeUploadResultJson(input.jobId, result),
  ]);

  await db.ocrJob.update({
    where: { id: input.jobId },
    data: {
      status: OcrJobStatus.COMPLETED,
      extractedText: extractedTextOffload.inline,
      extractedTextLocation: extractedTextOffload.location,
      result: (resultOffload.inline ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      resultLocation: resultOffload.location,
      metadata: toJsonValue(extractedMetadata),
      completedAt: new Date(),
      processingMs: Date.now() - input.startedAtMs,
    },
  });
  void dispatchJobWebhooks(input.jobId, "job.completed").catch(() => undefined);
  await finalizeOcrJob(input.jobId, input.settings.apiEndpoint, usedOllamaModels);
}

/**
 * Persist a failed OCR job: write the FAILED row with the captured
 * error message + final progress metadata, dispatch the job.failed
 * webhook, then finalize. Mirror of persistCompletedJob.
 */
async function persistFailedJob(
  input: ProcessOcrJobInput,
  errorMessage: string,
  metadata: OcrProgressMetadata,
  usedOllamaModels: Set<string>,
): Promise<void> {
  await db.ocrJob.update({
    where: { id: input.jobId },
    data: {
      status: OcrJobStatus.FAILED,
      metadata: toJsonValue(metadata),
      errorMessage,
      completedAt: new Date(),
      processingMs: Date.now() - input.startedAtMs,
    },
  });
  void dispatchJobWebhooks(input.jobId, "job.failed").catch(() => undefined);
  await finalizeOcrJob(input.jobId, input.settings.apiEndpoint, usedOllamaModels);
}

async function processOcrJobInBackground(input: ProcessOcrJobInput): Promise<void> {
  const startedAtIso = new Date(input.startedAtMs).toISOString();
  const pageOutputs: ProcessedPageOutput[] = input.initialPageOutputs ? [...input.initialPageOutputs] : [];
  const startIndex = Math.max(0, Math.min(input.startIndex ?? 0, input.inputPreviews.length));
  const checkpoints: OcrPageCheckpoint[] = pageOutputs.map(toPageCheckpoint);
  const pageRecords = pageOutputs.map(toPageRecord);
  const partialStructuredPages = pageOutputs.map(toStructuredPagePayload);
  const partialPageResults = pageOutputs.map(toPageResultPayload);
  let totalDurationMs = pageOutputs.reduce((sum, page) => sum + page.durationMs, 0);
  let { text: extractedTextSoFar, chunks: extractedChunkCount } = seedExtractedText(pageOutputs);

  const selectedPostProcessModel = input.postProcessingPayload.model || input.model;
  const usedOllamaModels = seedUsedOllamaModels(input.provider, input.ocrModel);

  let progressEvents: OcrProgressEvent[] = [];
  progressEvents = appendProgressEvent(
    progressEvents,
    "analyzing",
    input.resumed
      ? `Resuming from page ${startIndex + 1}/${input.inputPreviews.length}`
      : `Document analyzed: ${input.inputPreviews.length} page(s) ready`
  );
  if (input.provider === "mistral" && input.ocrModel !== input.model) {
    progressEvents = appendProgressEvent(
      progressEvents,
      "analyzing",
      `Using ${input.ocrModel} for OCR and ${input.model} for inference`
    );
  }

  let postProcessingMeta: OcrProgressMetadata["postProcessing"] = seedPostProcessingMeta(
    input.postProcessingPayload,
    selectedPostProcessModel,
  );

  let latestMetadata = buildProgressMetadata({
    stage: "analyzing",
    message: input.resumed
      ? `Resuming OCR from checkpoint (${pageOutputs.length}/${input.inputPreviews.length} pages complete)`
      : `Prepared ${input.inputPreviews.length} page(s) for OCR`,
    progressPct: 2,
    pageCount: input.inputPreviews.length,
    processedPages: pageOutputs.length,
    currentPage: null,
    etaSeconds: null,
    startedAt: startedAtIso,
    events: progressEvents,
    checkpoints,
    postProcessing: postProcessingMeta,
  });

  const pauseAtCheckpoint = async (stageMessage: string, eventMessage: string): Promise<void> => {
    progressEvents = appendProgressEvent(progressEvents, "paused", eventMessage);
    latestMetadata = buildProgressMetadata({
      stage: "paused",
      message: stageMessage,
      progressPct:
        input.postProcessingPayload.enabled
          ? (pageOutputs.length / input.inputPreviews.length) * 85
          : (pageOutputs.length / input.inputPreviews.length) * 100,
      pageCount: input.inputPreviews.length,
      processedPages: pageOutputs.length,
      currentPage: null,
      etaSeconds: null,
      startedAt: startedAtIso,
      events: progressEvents,
      checkpoints,
      postProcessing: postProcessingMeta,
    });

    await unloadAllOllamaModels(input.settings.apiEndpoint, usedOllamaModels);

    await db.ocrJob.update({
      where: { id: input.jobId },
      data: {
        status: OcrJobStatus.QUEUED,
        metadata: toJsonValue({
          ...latestMetadata,
          pageRecords,
        }),
        processingMs: Date.now() - input.startedAtMs,
      },
    });
    clearOcrJobRunning(input.jobId);
    await clearOcrJobStop(input.jobId);
  };

  try {
    await clearOcrJobStop(input.jobId);
    markOcrJobRunning(input.jobId);
    if (input.provider === "ollama") {
      await warmupOllamaModel(input.settings.apiEndpoint, input.ocrModel);
    }

    for (let index = startIndex; index < input.inputPreviews.length; index++) {
      if (await isOcrJobStopRequested(input.jobId)) {
        await pauseAtCheckpoint(
          "Stopped. Resume to continue from checkpoint.",
          `Stopped at ${pageOutputs.length}/${input.inputPreviews.length} page(s)`
        );
        return;
      }

      const pagePreview = input.inputPreviews[index];
      const pageNumber = index + 1;
      const pageStartMs = Date.now();

      progressEvents = appendProgressEvent(
        progressEvents,
        "ocr",
        `Running OCR on page ${pageNumber}/${input.inputPreviews.length}`
      );

      let pageText = "";
      let pageStructured: Record<string, unknown> = { markdown: "" };
      let pageMetadata: Record<string, unknown> = {};
      const pageAbortController = new AbortController();
      registerOcrJobAbortController(input.jobId, pageAbortController);
      try {
        ({ text: pageText, structured: pageStructured, metadata: pageMetadata } = await runProviderOcr(
          input.provider,
          input.settings,
          input.ocrModel,
          input.prompt,
          pagePreview,
          pageAbortController.signal
        ));
      } catch (error) {
        if (error instanceof OcrStopRequestedError || (await isOcrJobStopRequested(input.jobId))) {
          await pauseAtCheckpoint(
            "Stopped during inference. Resume to continue from checkpoint.",
            `Stopped during page ${pageNumber}/${input.inputPreviews.length} at ${pageOutputs.length}/${input.inputPreviews.length} page(s)`
          );
          return;
        }
        throw error;
      } finally {
        unregisterOcrJobAbortController(input.jobId, pageAbortController);
      }

      const durationMs = Date.now() - pageStartMs;
      totalDurationMs += durationMs;

      const completedPage: ProcessedPageOutput = {
        pageNumber,
        text: pageText,
        structured: pageStructured,
        metadata: pageMetadata,
        durationMs,
      };

      pageOutputs.push(completedPage);
      checkpoints.push(toPageCheckpoint(completedPage));
      pageRecords.push(toPageRecord(completedPage));
      partialStructuredPages.push(toStructuredPagePayload(completedPage));
      partialPageResults.push(toPageResultPayload(completedPage));

      ({ text: extractedTextSoFar, chunks: extractedChunkCount } = appendPageMarkdown(
        extractedTextSoFar,
        extractedChunkCount,
        completedPage,
      ));

      const averagePageMs = totalDurationMs / pageOutputs.length;
      const remainingPages = input.inputPreviews.length - pageOutputs.length;
      const etaSeconds =
        remainingPages > 0 ? Math.max(1, Math.round((averagePageMs * remainingPages) / 1000)) : 0;
      const ocrProgress =
        input.postProcessingPayload.enabled
          ? (pageOutputs.length / input.inputPreviews.length) * 85
          : (pageOutputs.length / input.inputPreviews.length) * 100;

      progressEvents = appendProgressEvent(
        progressEvents,
        "ocr",
        `Completed page ${pageNumber}/${input.inputPreviews.length} in ${Math.round(durationMs / 100) / 10}s`
      );

      latestMetadata = buildProgressMetadata({
        stage: "ocr",
        message: `Completed page ${pageNumber}/${input.inputPreviews.length}`,
        progressPct: ocrProgress,
        pageCount: input.inputPreviews.length,
        processedPages: pageOutputs.length,
        currentPage: pageNumber,
        etaSeconds,
        startedAt: startedAtIso,
        events: progressEvents,
        checkpoints,
        postProcessing: postProcessingMeta,
      });

      await db.ocrJob.update({
        where: { id: input.jobId },
        data: {
          extractedText: extractedTextSoFar,
          metadata: toJsonValue({
            ...latestMetadata,
            pageRecords,
          }),
        },
      });
    }

    const extractedMarkdown = extractedTextSoFar.trim();
    if (!extractedMarkdown) {
      throw new ApiRouteError("OCR returned no text", 502);
    }

    const pageScopedText = formatPageScopedText(pageOutputs);
    const extractedMetadata: Record<string, unknown> = {
      ocrModel: input.ocrModel,
      inferenceModel: input.model,
      pageCount: input.inputPreviews.length,
      pageResults: partialPageResults,
    };
    let finalMarkdown = extractedMarkdown;
    let postProcessedJson: unknown = undefined;
    let postProcessedText: string | undefined;

    if (input.postProcessingPayload.enabled) {
      const postProcessingModel = selectedPostProcessModel;
      const postProcessingProvider = resolveProvider(postProcessingModel, input.settings);
      if (postProcessingProvider === "ollama") {
        usedOllamaModels.add(postProcessingModel);
        await warmupOllamaModel(input.settings.apiEndpoint, postProcessingModel);
      }

      progressEvents = appendProgressEvent(
        progressEvents,
        "post_processing",
        `Running post-processing with ${postProcessingModel}`
      );
      latestMetadata = buildProgressMetadata({
        stage: "post_processing",
        message: `Applying post-processing with ${postProcessingModel}`,
        progressPct: 90,
        pageCount: input.inputPreviews.length,
        processedPages: pageOutputs.length,
        currentPage: null,
        etaSeconds: 2,
        startedAt: startedAtIso,
        events: progressEvents,
        checkpoints,
        postProcessing: postProcessingMeta,
      });
      await db.ocrJob.update({
        where: { id: input.jobId },
        data: {
          metadata: toJsonValue(latestMetadata),
        },
      });

      const { systemPrompt, userPrompt } = buildPostProcessingPrompt(input.postProcessingPayload);
      const postProcessRequestText = [
        userPrompt,
        "",
        "OCR source text grouped by page:",
        pageScopedText,
      ].join("\n");

      try {
        let postProcessResult: { text: string; metadata: Record<string, unknown> };
        postProcessResult = await runProviderPostProcessing(
          postProcessingProvider,
          input.settings,
          postProcessingModel,
          systemPrompt,
          postProcessRequestText,
          input.postProcessingPayload.outputFormat
        );

        const normalizedPostProcessed = normalizePostProcessedText(
          postProcessResult.text,
          input.postProcessingPayload.outputFormat
        );
        if (normalizedPostProcessed.text) {
          postProcessedText = normalizedPostProcessed.text;
          postProcessedJson = normalizedPostProcessed.parsedJson;
          if (input.postProcessingPayload.outputFormat === "markdown") {
            finalMarkdown = normalizedPostProcessed.text;
          }
        }

        postProcessingMeta = {
          enabled: true,
          applied: Boolean(postProcessedText),
          outputFormat: input.postProcessingPayload.outputFormat,
          instruction: input.postProcessingPayload.instruction,
          model: postProcessingModel,
          provider: postProcessingProvider,
        };
        extractedMetadata.postProcessing = {
          ...postProcessingMeta,
          ...postProcessResult.metadata,
        };
      } catch (error) {
        postProcessingMeta = {
          enabled: true,
          applied: false,
          outputFormat: input.postProcessingPayload.outputFormat,
          instruction: input.postProcessingPayload.instruction,
          model: postProcessingModel,
          provider: postProcessingProvider,
          error: error instanceof Error ? error.message : "Post-processing failed",
        };
        extractedMetadata.postProcessing = postProcessingMeta;
      }
    } else {
      extractedMetadata.postProcessing = {
        enabled: false,
      };
    }

    const result = buildJsonResult(
      input.fileName,
      input.model,
      input.provider,
      input.settingsPayload,
      finalMarkdown,
      {
        markdown: finalMarkdown,
        rawMarkdown: extractedMarkdown,
        pages: partialStructuredPages,
        ...(postProcessedText
          ? {
              postProcessingOutput:
                input.postProcessingPayload.outputFormat === "json"
                  ? {
                      json: postProcessedJson ?? null,
                      rawText: postProcessedText,
                    }
                  : {
                      markdown: postProcessedText,
                    },
            }
          : {}),
      },
      extractedMetadata
    );
    result.rawExtractionText = extractedMarkdown;
    if (postProcessedText) {
      result.postProcessedText = postProcessedText;
    }
    if (postProcessedJson !== undefined) {
      extractedMetadata.postProcessingJson = postProcessedJson;
    }

    progressEvents = appendProgressEvent(progressEvents, "completed", "OCR job completed");
    latestMetadata = buildProgressMetadata({
      stage: "completed",
      message: "Completed",
      progressPct: 100,
      pageCount: input.inputPreviews.length,
      processedPages: pageOutputs.length,
      currentPage: null,
      etaSeconds: 0,
      startedAt: startedAtIso,
      events: progressEvents,
      checkpoints,
      postProcessing: postProcessingMeta,
    });
    extractedMetadata.progress = latestMetadata;

    await persistCompletedJob(input, finalMarkdown, result, extractedMetadata, usedOllamaModels);
  } catch (error) {
    progressEvents = appendProgressEvent(
      progressEvents,
      "failed",
      error instanceof Error ? error.message : "OCR processing failed"
    );
    latestMetadata = buildProgressMetadata({
      stage: "failed",
      message: error instanceof Error ? error.message : "OCR processing failed",
      progressPct: latestMetadata.progressPct,
      pageCount: input.inputPreviews.length,
      processedPages: pageOutputs.length,
      currentPage: null,
      etaSeconds: null,
      startedAt: startedAtIso,
      events: progressEvents,
      checkpoints,
      postProcessing: postProcessingMeta,
    });

    await persistFailedJob(
      input,
      error instanceof Error ? error.message : "OCR processing failed",
      latestMetadata,
      usedOllamaModels,
    );
  }
}

function parseCheckpointPages(
  result: unknown,
  metadata?: unknown
): ProcessedPageOutput[] {
  const rawCheckpointPages =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as { pageRecords?: unknown }).pageRecords
      : undefined;
  const fromResult = result && typeof result === "object" && !Array.isArray(result)
    ? (result as { metadata?: { pageRecords?: unknown } }).metadata?.pageRecords
    : undefined;
  const checkpointSource = Array.isArray(rawCheckpointPages) ? rawCheckpointPages : fromResult;

  if (!Array.isArray(checkpointSource)) {
    return [];
  }

  const normalized = checkpointSource
    .map((page) => {
      if (!page || typeof page !== "object" || Array.isArray(page)) {
        return null;
      }
      const typed = page as {
        pageNumber?: unknown;
        text?: unknown;
        structured?: unknown;
        durationMs?: unknown;
        metadata?: unknown;
      };
      if (typeof typed.pageNumber !== "number" || typeof typed.text !== "string") {
        return null;
      }

      return {
        pageNumber: typed.pageNumber,
        text: typed.text,
        structured:
          typed.structured && typeof typed.structured === "object" && !Array.isArray(typed.structured)
            ? (typed.structured as Record<string, unknown>)
            : { markdown: typed.text },
        durationMs: typeof typed.durationMs === "number" ? typed.durationMs : 0,
        metadata:
          typed.metadata && typeof typed.metadata === "object" && !Array.isArray(typed.metadata)
            ? (typed.metadata as Record<string, unknown>)
            : {},
      };
    })
    .filter((page): page is ProcessedPageOutput => Boolean(page))
    .sort((a, b) => a.pageNumber - b.pageNumber);

  return normalized;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      throw new ApiRouteError("Unauthorized", 401);
    }
    const scopeError = requireScope(auth, "ocr:read");
    if (scopeError) return scopeError;
    const userId = auth.userId;

    const storedSettings = normalizeAndValidateApiSettings(await getApiSettings(userId));
    const query = new URL(request.url).searchParams;
    const provider = normalizeProvider(query.get("provider") || undefined);
    const catalog = await getModelCatalog(storedSettings);
    return NextResponse.json({ success: true, models: catalog[provider] });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fetch model catalog",
      },
      { status: error instanceof ApiRouteError ? error.status : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const startedAtMs = Date.now();
  try {
    const authResult = await authenticateMutation(request);
    if (!authResult.ok) {
      throw new ApiRouteError(authResult.error, authResult.status);
    }
    const auth = authResult.auth;
    const submitScopeError = requireScope(auth, "ocr:submit");
    if (submitScopeError) return submitScopeError;
    const userId = auth.userId;

    const clientIp = getClientIpAddress(request);
    const rateLimitKey =
      auth.method === "api-key" && auth.apiKeyId
        ? `ocr:job:key:${auth.apiKeyId}`
        : `ocr:job:${userId}:${clientIp}`;
    const rateLimitMax =
      auth.method === "api-key" && auth.rateLimitPerMinute && auth.rateLimitPerMinute > 0
        ? auth.rateLimitPerMinute
        : OCR_RATE_LIMIT_MAX;
    const rateLimit = consumeRateLimit({
      key: rateLimitKey,
      max: rateLimitMax,
      windowMs: OCR_RATE_LIMIT_WINDOW_MS,
    });
    if (!rateLimit.allowed) {
      return handleApiError(
        new ApiRouteError("Too many OCR jobs requested. Please retry shortly.", 429),
        {
          extra: { success: false },
          headers: { "Retry-After": `${rateLimit.retryAfterSeconds}` },
        }
      );
    }

    const storedSettings = normalizeAndValidateApiSettings(await getApiSettings(userId));
    const body = (await request.json().catch(() => null)) as OCRRequestBody | null;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiRouteError("Invalid JSON payload", 400);
    }

    const fileName = typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim()
      : "untitled";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const preview = typeof body.preview === "string" ? body.preview.trim() : "";
    const pagePreviews = Array.isArray(body.pages)
      ? body.pages
          .map((page) => (typeof page === "string" ? page.trim() : ""))
          .filter(Boolean)
      : [];
    const inputPreviews = pagePreviews.length > 0
      ? pagePreviews
      : preview
        ? [preview]
        : [];
    const settingsPayload = normalizeAdvancedSettings(body.settings);
    const postProcessingPayload = sanitizePostProcessing(body.postProcessing);
    const settings = storedSettings;

    if (!model) {
      throw new ApiRouteError("Model is required", 400);
    }

    if (inputPreviews.length === 0) {
      throw new ApiRouteError("No image preview provided", 400);
    }

    const resumeRequested = body.resume === true || body.resume === "true";
    const resumeJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

    const provider = resolveProvider(model, settings);
    const ocrModel = provider === "mistral" ? resolveMistralOcrModel(model) : model;
    const prompt = buildPrompt(settingsPayload);
    const sourcePreview = normalizePreviewForHistory(inputPreviews[0] || "");
    const startedAtIso = new Date(startedAtMs).toISOString();

    if (resumeRequested) {
      if (!resumeJobId) {
        throw new ApiRouteError("jobId is required when resume=true", 400);
      }

      const existingJob = await db.ocrJob.findFirst({
        where: {
          id: resumeJobId,
          userId,
        },
        select: {
          id: true,
          status: true,
          result: true,
          metadata: true,
          priority: true,
        },
      });
      if (!existingJob) {
        throw new ApiRouteError("Resume job not found", 404);
      }

      if (existingJob.status === OcrJobStatus.COMPLETED) {
        throw new ApiRouteError("Job is already completed", 400);
      }
      if (existingJob.status === OcrJobStatus.PROCESSING) {
        throw new ApiRouteError("Job is already processing", 409);
      }

      const initialPageOutputs = parseCheckpointPages(existingJob.result, existingJob.metadata);
      const startIndex = initialPageOutputs.length;
      if (startIndex >= inputPreviews.length) {
        throw new ApiRouteError("All pages were already checkpointed for this job", 400);
      }

      const resumeMetadata = buildProgressMetadata({
        stage: "queued",
        message: `Resume requested from page ${startIndex + 1}/${inputPreviews.length}`,
        progressPct:
          postProcessingPayload.enabled
            ? (startIndex / inputPreviews.length) * 85
            : (startIndex / inputPreviews.length) * 100,
        pageCount: inputPreviews.length,
        processedPages: startIndex,
        currentPage: null,
        etaSeconds: null,
        startedAt: startedAtIso,
        events: [
          {
            at: startedAtIso,
            stage: "queued",
            message: "Resume requested",
          },
          ...(provider === "mistral" && ocrModel !== model
            ? [
                {
                  at: startedAtIso,
                  stage: "queued" as const,
                  message: `OCR will use ${ocrModel}; selected inference model is ${model}`,
                },
              ]
            : []),
        ],
        checkpoints: initialPageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          status: "completed",
          characterCount: page.text.length,
          durationMs: page.durationMs,
          previewText: page.text.trim().slice(0, 320),
        })),
        postProcessing: {
          enabled: postProcessingPayload.enabled,
          ...(postProcessingPayload.enabled
            ? {
                outputFormat: postProcessingPayload.outputFormat,
                instruction: postProcessingPayload.instruction,
                model: postProcessingPayload.model || model,
              }
            : {}),
        },
      });

      await db.ocrJob.update({
        where: { id: existingJob.id },
        data: {
          status: OcrJobStatus.PROCESSING,
          sourcePreview,
          errorMessage: null,
          completedAt: null,
          processingMs: null,
          settingsSnapshot: toJsonValue({
            settings: settingsPayload,
            postProcessing: postProcessingPayload,
          }),
          prompt,
          metadata: toJsonValue(resumeMetadata),
        },
      });

      const resumePriority = (existingJob as { priority?: number }).priority ?? 0;
      void withOcrJobSlot(resumePriority, () =>
        processOcrJobInBackground({
          jobId: existingJob.id,
          startedAtMs,
          fileName,
          model,
          ocrModel,
          provider,
          settings,
          settingsPayload,
          postProcessingPayload,
          inputPreviews,
          prompt,
          initialPageOutputs,
          startIndex,
          resumed: true,
        })
      );

      return NextResponse.json(
        {
          success: true,
          status: OcrJobStatus.PROCESSING,
          jobId: existingJob.id,
          pageCount: inputPreviews.length,
          resumed: true,
          pageRecords: startIndex,
        },
        { status: 202 }
      );
    }

    const initialMetadata = buildProgressMetadata({
      stage: "queued",
      message: "Queued for OCR",
      progressPct: 0,
      pageCount: inputPreviews.length,
      processedPages: 0,
      currentPage: null,
      etaSeconds: null,
      startedAt: startedAtIso,
      events: [
        {
          at: startedAtIso,
          stage: "queued",
          message: "Job created",
        },
        ...(provider === "mistral" && ocrModel !== model
          ? [
              {
                at: startedAtIso,
                stage: "queued" as const,
                message: `OCR will use ${ocrModel}; selected inference model is ${model}`,
              },
            ]
          : []),
      ],
      checkpoints: [],
      postProcessing: {
        enabled: postProcessingPayload.enabled,
        ...(postProcessingPayload.enabled
          ? {
              outputFormat: postProcessingPayload.outputFormat,
              instruction: postProcessingPayload.instruction,
              model: postProcessingPayload.model || model,
            }
          : {}),
      },
    });

    const requestedPriority = parseRequestPriority(body?.priority);
    const requestedBatchId = typeof body?.batchId === "string" && body.batchId.trim()
      ? body.batchId.trim().slice(0, 64)
      : null;
    const createdJob = await db.ocrJob.create({
      data: {
        userId,
        apiKeyId: authResult.auth.method === "api-key" ? authResult.auth.apiKeyId ?? null : null,
        status: OcrJobStatus.PROCESSING,
        priority: requestedPriority,
        batchId: requestedBatchId,
        fileName,
        sourcePreview,
        model,
        language: settingsPayload.language,
        tableDetection: settingsPayload.tableDetection,
        handwritingRecognition: settingsPayload.handwritingRecognition,
        preserveFormatting: settingsPayload.preserveFormatting,
        customPrompt: settingsPayload.customPrompt,
        quality: settingsPayload.quality,
        settingsSnapshot: toJsonValue({
          settings: settingsPayload,
          postProcessing: postProcessingPayload,
        }),
        prompt,
        metadata: toJsonValue(initialMetadata),
      },
      select: { id: true },
    });
    void withOcrJobSlot(requestedPriority, () =>
      processOcrJobInBackground({
        jobId: createdJob.id,
        startedAtMs,
        fileName,
        model,
        ocrModel,
        provider,
        settings,
        settingsPayload,
        postProcessingPayload,
        inputPreviews,
        prompt,
      })
    );

    return NextResponse.json(
      {
        success: true,
        status: OcrJobStatus.PROCESSING,
        jobId: createdJob.id,
        pageCount: inputPreviews.length,
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("OCR processing error:", error);
    return handleApiError(error, {
      statusFor: pipelineStatusFor,
      extra: { success: false },
    });
  }
}
