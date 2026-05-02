import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

import { ApiProviderSettings, getApiSettings, normalizeMistralEndpoint } from "@/lib/settings-store";
import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
import {
  maybeUploadResultJson,
  maybeUploadResultText,
} from "@/lib/result-store";
import { dispatchJobWebhooks } from "@/lib/webhooks";
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
import { ApiRouteError } from "@/lib/api-error";
import { extractFirstBalancedJsonObject, extractMarkdownFromJsonLikeText } from "@/lib/ocr/text-extract";

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



class OcrStopRequestedError extends Error {
  constructor(message = "OCR stop requested") {
    super(message);
    this.name = "OcrStopRequestedError";
  }
}

const DEFAULT_OLLAMA_HOST = normalizeHostEndpoint(
  process.env.OLLAMA_HOST || "",
  "http://127.0.0.1:11434"
);
const FALLBACK_OLLAMA_HOST = resolveOllamaHostEndpoint(
  DEFAULT_OLLAMA_HOST,
  "http://127.0.0.1:11434",
);
const APP_NETWORK_MODE = (process.env.APP_NETWORK_MODE || "bridge").trim().toLowerCase();
const DEFAULT_MISTRAL_API_URL =
  process.env.MISTRAL_OCR_API_URL?.trim() || "https://api.mistral.ai/v1/ocr";
const DEFAULT_MISTRAL_OCR_MODEL = (process.env.MISTRAL_OCR_MODEL || "mistral-ocr-latest").trim();
const DEFAULT_MISTRAL_MODELS = (() => {
  const configured = (process.env.MISTRAL_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length > 0
    ? configured
    : [
        "mistral-ocr-latest",
        "mistral-ocr",
        "pixtral-12b",
      ];
})();
const DEFAULT_OPENROUTER_API_URL =
  process.env.OPENROUTER_API_URL?.trim() || "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_FALLBACK_MODELS = (() => {
  const configured = (process.env.OPENROUTER_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length > 0
    ? configured
    : [
        "anthropic/claude-3.5-sonnet",
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
        "google/gemini-2.0-flash-001",
        "qwen/qwen-2-vl-72b-instruct",
      ];
})();
const OPENROUTER_REFERER = (process.env.OPENROUTER_REFERER || "").trim();
const OPENROUTER_TITLE = (process.env.OPENROUTER_TITLE || "Extracto").trim();
const OPENROUTER_MODEL_CACHE_TTL_MS = 5 * 60_000;

const DEFAULT_OPENAI_COMPAT_API_URL =
  process.env.OPENAI_COMPAT_API_URL?.trim() || "https://api.openai.com/v1";
const DEFAULT_OPENAI_COMPAT_FALLBACK_MODELS = (() => {
  const configured = (process.env.OPENAI_COMPAT_MODELS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length > 0
    ? configured
    : [
        "gpt-4o",
        "gpt-4o-mini",
      ];
})();
const OPENAI_COMPAT_MODEL_CACHE_TTL_MS = 5 * 60_000;
const OPENAI_COMPAT_MODEL_CACHE_MAX_ENTRIES = 256;

const REQUEST_TIMEOUT_MS = 60_000;
const OLLAMA_MODEL_CACHE_TTL_MS = 60_000;
const MAX_STORED_PREVIEW_LENGTH = 1_500_000;
const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;
const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
const OCR_RATE_LIMIT_MAX = 6;
const OLLAMA_DISCOVERY_FALLBACK_HOST =
  APP_NETWORK_MODE === "host" ? "http://127.0.0.1:11434" : FALLBACK_OLLAMA_HOST;
const OLLAMA_DISCOVERY_PATHS = ["/api/tags", "/v1/models"] as const;
const OLLAMA_NETWORK_HINT =
  "If Ollama runs on the host machine, ensure it is bound to 0.0.0.0:11434 (not only 127.0.0.1), and from the container use a host-reachable address.";

let ollamaModelCache: {
  values: string[];
  expiresAt: number;
  host: string;
} = {
  values: [],
  expiresAt: 0,
  host: "",
};

const OPENROUTER_MODEL_CACHE_MAX_ENTRIES = 256;
const openRouterModelCache = new Map<
  string,
  { values: string[]; expiresAt: number }
>();

const openAICompatModelCache = new Map<
  string,
  { values: string[]; expiresAt: number }
>();

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
  const candidates = getOllamaHostCandidates(endpoint).map(normalizeOllamaEndpoint);
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

function normalizeApiSettings(raw: ApiProviderSettings): ApiProviderSettings {
  const provider = normalizeProvider(raw.provider);
  return {
    provider,
    apiEndpoint: normalizeProviderEndpoint(provider, raw.apiEndpoint),
    apiKey: raw.apiKey?.trim() || "",
  };
}

function normalizeOpenAICompatApiBase(rawEndpoint: string): string {
  // BYO endpoint: respect operator-supplied base path verbatim. We only
  // normalize scheme, drop trailing slash and any chat/completions or
  // models suffix the user might have pasted.
  const trimmed = rawEndpoint.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_COMPAT_API_URL;
  }
  try {
    const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.search = "";
    url.hash = "";
    const pathname = url.pathname
      .replace(/\/+$/u, "")
      .replace(/\/(chat\/completions|models)$/u, "");
    url.pathname = pathname;
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return DEFAULT_OPENAI_COMPAT_API_URL;
  }
}

function normalizeOpenRouterApiBase(rawEndpoint: string): string {
  const trimmed = rawEndpoint.trim();
  if (!trimmed) {
    return DEFAULT_OPENROUTER_API_URL;
  }

  try {
    const url = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`);
    url.search = "";
    url.hash = "";
    let pathname = url.pathname.replace(/\/+$/u, "");
    if (!pathname || pathname === "/") {
      pathname = "/api/v1";
    } else if (pathname.endsWith("/api")) {
      pathname = `${pathname}/v1`;
    }
    pathname = pathname.replace(/\/(chat\/completions|models)$/u, "");
    url.pathname = pathname;
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return DEFAULT_OPENROUTER_API_URL;
  }
}

function normalizeOllamaEndpoint(rawEndpoint: string): string {
  const resolvedHost = resolveOllamaHostEndpoint(
    rawEndpoint,
    OLLAMA_DISCOVERY_FALLBACK_HOST,
  );
  return normalizeHostEndpoint(resolvedHost, OLLAMA_DISCOVERY_FALLBACK_HOST)
    .replace(/\/api\/?$/i, "")
    .replace(/\/v1\/?$/i, "");
}

function buildMistralOcrEndpointCandidates(rawEndpoint: string): string[] {
  const baseEndpoint = normalizeMistralEndpoint(rawEndpoint);
  const withoutProcess = baseEndpoint.replace(/\/process$/iu, "");
  const withProcess = withoutProcess.endsWith("/ocr")
    ? `${withoutProcess}/process`
    : `${withoutProcess}/ocr/process`;
  const candidates = Array.from(new Set([withoutProcess, withProcess]));
  return candidates
    .map((candidate) => {
      try {
        return enforceProviderEndpointPolicy("mistral", candidate, DEFAULT_MISTRAL_API_URL);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

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

function isLikelyMistralOcrModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes("ocr");
}

function resolveMistralOcrModel(selectedModel: string): string {
  return isLikelyMistralOcrModel(selectedModel) ? selectedModel : DEFAULT_MISTRAL_OCR_MODEL;
}

function parsePreviewImageData(preview: string): {
  mimeType: string;
  base64: string;
  dataUrl: string;
} {
  if (!preview) {
    return {
      mimeType: "image/jpeg",
      base64: "",
      dataUrl: "",
    };
  }

  const match = preview.match(/^data:([^;]+);base64,(.*)$/i);
  if (match) {
    const mimeType = match[1]?.trim() || "image/jpeg";
    const base64 = match[2] || "";
    return {
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
    };
  }

  if (preview.startsWith("data:") && preview.includes(",")) {
    const base64 = preview.slice(preview.indexOf(",") + 1);
    const mimeMatch = preview.match(/^data:([^;,]+)/i);
    const mimeType = mimeMatch?.[1]?.trim() || "image/jpeg";
    return {
      mimeType,
      base64,
      dataUrl: `data:${mimeType};base64,${base64}`,
    };
  }

  const base64 = preview.trim();
  return {
    mimeType: "image/jpeg",
    base64,
    dataUrl: `data:image/jpeg;base64,${base64}`,
  };
}

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

function extractStructuredPageEntryMarkdown(
  structured: Record<string, unknown>,
  pageNumber: number
): string {
  const rawPages = Array.isArray(structured.pages) ? structured.pages : [];
  if (!rawPages.length) {
    return "";
  }

  const matching = rawPages
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const typed = entry as Record<string, unknown>;
      const indexValue = typeof typed.index === "number"
        ? Math.floor(typed.index)
        : typeof typed.pageNumber === "number"
          ? Math.floor(typed.pageNumber)
          : typeof typed.page === "number"
            ? Math.floor(typed.page)
            : null;
      if (
        indexValue !== null &&
        indexValue !== pageNumber &&
        indexValue !== pageNumber - 1
      ) {
        return "";
      }
      return coerceMarkdownText(
        typed.markdown ?? typed.text ?? typed.content ?? typed.html,
        ""
      );
    })
    .filter(Boolean);

  return matching.join("\n\n").trim();
}

function getPageMarkdownForRouting(page: {
  pageNumber: number;
  text: string;
  structured: Record<string, unknown>;
}): string {
  const directMarkdown = coerceMarkdownText(
    page.structured.markdown ??
      page.structured.text ??
      page.structured.content ??
      page.structured.extractedText,
    ""
  );
  const pageEntryMarkdown = extractStructuredPageEntryMarkdown(page.structured, page.pageNumber);
  const fallback = page.text.trim();
  return coerceMarkdownText(directMarkdown || pageEntryMarkdown || fallback, fallback);
}


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

function extractChatContentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }

        if (!entry || typeof entry !== "object") {
          return "";
        }

        const typedEntry = entry as { type?: unknown; text?: unknown };
        if (typedEntry.type === "text" && typeof typedEntry.text === "string") {
          return typedEntry.text.trim();
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function parseJsonCandidate(rawText: string): unknown | null {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return null;
  }

  const directCandidates = [
    trimmed,
    trimmed.replace(/^json\s*/iu, "").trim(),
    trimmed.replace(/^['"]+|['"]+$/g, "").trim(),
  ];

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fencedMatch?.[1]) {
    directCandidates.unshift(fencedMatch[1].trim());
  }

  for (const candidate of directCandidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // keep trying fallbacks
    }
  }

  const bracketCandidate = extractFirstBalancedJsonObject(trimmed);
  if (bracketCandidate) {
    try {
      return JSON.parse(bracketCandidate);
    } catch {
      return null;
    }
  }

  return null;
}

function coerceMarkdownText(value: unknown, fallbackMarkdown: string): string {
  const fallback = fallbackMarkdown.trim();
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = parseJsonCandidate(trimmed);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const objectValue = parsed as Record<string, unknown>;
    const nestedValue = objectValue.markdown ?? objectValue.text ?? objectValue.content;
    if (typeof nestedValue === "string" && nestedValue.trim()) {
      return nestedValue.trim();
    }
  }

  const extractedFromPseudoJson = extractMarkdownFromJsonLikeText(trimmed);
  if (extractedFromPseudoJson) {
    return extractedFromPseudoJson;
  }

  return trimmed;
}

function normalizeStructuredMarkdownPayload(
  raw: unknown,
  fallbackMarkdown: string
): {
  markdown: string;
  structured: Record<string, unknown>;
  parseMode: "json" | "markdown";
} {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const objectValue = raw as Record<string, unknown>;
    const markdown = coerceMarkdownText(
      objectValue.markdown ?? objectValue.text ?? objectValue.content,
      fallbackMarkdown
    );

    return {
      markdown,
      structured: {
        ...objectValue,
        markdown,
      },
      parseMode: "json",
    };
  }

  const markdown = fallbackMarkdown.trim();
  return {
    markdown,
    structured: {
      markdown,
    },
    parseMode: "markdown",
  };
}

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

async function parseResponseText(response: Response): Promise<unknown> {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawText);
  } catch {
    return { message: rawText };
  }
}

function parseServiceError(response: Response, payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "object" &&
    (payload as { error: Record<string, unknown> }).error !== null
  ) {
    const nestedError = (payload as { error: Record<string, unknown> }).error;
    if (typeof nestedError.message === "string") {
      return nestedError.message;
    }
    if (typeof nestedError.detail === "string") {
      return nestedError.detail;
    }
    const nestedErrors = nestedError.errors as unknown[] | undefined;
    if (
      Array.isArray(nestedErrors) &&
      nestedErrors.length > 0 &&
      typeof nestedErrors[0] === "string"
    ) {
      return nestedErrors[0] as string;
    }
  }

  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "detail" in payload &&
    typeof (payload as { detail?: unknown }).detail === "string"
  ) {
    return (payload as { detail: string }).detail;
  }

  return response.statusText || "Request failed";
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  let abortedByExternalSignal = false;
  let timeoutTriggered = false;
  const onExternalAbort = () => {
    abortedByExternalSignal = true;
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortedByExternalSignal = true;
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (abortedByExternalSignal) {
      throw new OcrStopRequestedError();
    }

    if (
      timeoutTriggered &&
      error instanceof Error &&
      (error.name === "AbortError" || /abort/iu.test(error.message))
    ) {
      throw new ApiRouteError(`Request timeout after ${timeoutMs}ms`, 504);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

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

type OcrRunResult = { text: string; structured: Record<string, unknown>; metadata: Record<string, unknown> };

async function runProviderOcr(
  provider: ProviderKind,
  settings: ApiProviderSettings,
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal
): Promise<OcrRunResult> {
  if (provider === "ollama") {
    return runOllamaOcr(settings.apiEndpoint, model, prompt, preview, signal);
  }
  if (provider === "openrouter") {
    return runCompatOcr(OPENROUTER_CONFIG, settings.apiEndpoint, model, settings.apiKey || process.env.OPENROUTER_API_KEY || "", prompt, preview, signal);
  }
  if (provider === "openai_compat") {
    return runCompatOcr(OPENAI_COMPAT_CONFIG, settings.apiEndpoint, model, settings.apiKey || process.env.OPENAI_COMPAT_API_KEY || "", prompt, preview, signal);
  }
  return runMistralOcr(settings.apiEndpoint, model, settings.apiKey || process.env.MISTRAL_API_KEY || "", preview, signal);
}

type PostProcessResult = { text: string; metadata: Record<string, unknown> };

async function runProviderPostProcessing(
  provider: ProviderKind,
  settings: ApiProviderSettings,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat
): Promise<PostProcessResult> {
  if (provider === "ollama") {
    return runOllamaPostProcessing(settings.apiEndpoint, model, systemPrompt, userPrompt);
  }
  if (provider === "openrouter") {
    return runCompatPostProcessing(OPENROUTER_CONFIG, settings.apiEndpoint, model, settings.apiKey || process.env.OPENROUTER_API_KEY || "", systemPrompt, userPrompt, outputFormat);
  }
  if (provider === "openai_compat") {
    return runCompatPostProcessing(OPENAI_COMPAT_CONFIG, settings.apiEndpoint, model, settings.apiKey || process.env.OPENAI_COMPAT_API_KEY || "", systemPrompt, userPrompt, outputFormat);
  }
  return runMistralPostProcessing(model, settings.apiKey || process.env.MISTRAL_API_KEY || "", settings.apiEndpoint, systemPrompt, userPrompt, outputFormat);
}


async function runOllamaOcr(
  endpoint: string,
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal
): Promise<OcrRunResult> {
  const imageData = parsePreviewImageData(preview);
  if (!imageData.base64) {
    throw new ApiRouteError("Invalid image data for Ollama OCR", 400);
  }

  const errors: string[] = [];
  const candidates = getOllamaCandidatesForOcr(endpoint);
  const chatEndpoints = ["/api/chat", "/v1/chat/completions"];

  for (const rawCandidate of candidates) {
    const host = normalizeOllamaApiBase(rawCandidate);
    for (const chatPath of chatEndpoints) {
      try {
        const response = await fetchWithTimeout(`${host}${chatPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            chatPath === "/api/chat"
              ? {
                  model,
                  messages: [
                    {
                      role: "user",
                      content: prompt,
                      images: [imageData.base64],
                    },
                  ],
                  stream: false,
                }
              : {
                  model,
                  messages: [
                    {
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: prompt,
                        },
                        {
                          type: "image_url",
                          image_url: {
                            url: imageData.dataUrl,
                          },
                        },
                      ],
                    },
                  ],
                  temperature: 0,
                  stream: false,
                }
          ),
        }, REQUEST_TIMEOUT_MS, signal);

        const payload = await parseResponseText(response);
        if (!response.ok) {
          errors.push(
            `${host}${chatPath}: ${response.status} ${parseServiceError(response, payload)}`
          );
          continue;
        }

        if (!payload || typeof payload !== "object") {
          errors.push(`${host}${chatPath}: invalid OCR response payload`);
          continue;
        }

        const openAiChoices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
        const message = chatPath === "/api/chat"
          ? (payload as { message?: { content?: unknown } }).message
          : Array.isArray(openAiChoices)
            ? openAiChoices[0]?.message
            : undefined;
        const payloadWithMetrics = payload as {
          done?: unknown;
          eval_count?: unknown;
          total_duration?: unknown;
        };

        const text = extractChatContentText(message?.content);
        if (!text) {
          errors.push(`${host}${chatPath}: OCR response had no text`);
          continue;
        }

        const parsedPayload = parseJsonCandidate(text);
        const normalizedPayload = normalizeStructuredMarkdownPayload(parsedPayload, text);
        if (!normalizedPayload.markdown) {
          errors.push(`${host}${chatPath}: OCR response markdown was empty`);
          continue;
        }

        return {
          text: normalizedPayload.markdown,
          structured: normalizedPayload.structured,
          metadata: {
            responseDone: typeof payloadWithMetrics.done === "boolean" ? payloadWithMetrics.done : undefined,
            evalCount: typeof payloadWithMetrics.eval_count === "number"
              ? payloadWithMetrics.eval_count
              : undefined,
            totalDurationMs:
              typeof payloadWithMetrics.total_duration === "number"
                ? payloadWithMetrics.total_duration
                : undefined,
            outputFormat: normalizedPayload.parseMode,
          },
        };
      } catch (error) {
        if (error instanceof OcrStopRequestedError) {
          throw error;
        }
        errors.push(
          `${host}${chatPath}: ${error instanceof Error ? error.message : "Request failed"}`
        );
      }
    }
  }

  let resolvedHost: string | null = null;
  try {
    resolvedHost = (await getOllamaModels(endpoint)).host;
  } catch {
    // keep fallback message context
  }
  const hint = resolvedHost
    ? `Last reachable host was ${resolvedHost}.`
    : "No reachable Ollama endpoint found.";
  throw new ApiRouteError(`${hint} ${errors.join(" | ")}. ${OLLAMA_NETWORK_HINT}`, 502);
}

async function runOllamaPostProcessing(
  endpoint: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  const errors: string[] = [];
  const candidates = getOllamaCandidatesForOcr(endpoint);
  const chatEndpoints = ["/api/chat", "/v1/chat/completions"] as const;

  for (const rawCandidate of candidates) {
    const host = normalizeOllamaApiBase(rawCandidate);
    for (const chatPath of chatEndpoints) {
      try {
        const response = await fetchWithTimeout(`${host}${chatPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: false,
            temperature: 0,
          }),
        });

        const payload = await parseResponseText(response);
        if (!response.ok) {
          errors.push(
            `${host}${chatPath}: ${response.status} ${parseServiceError(response, payload)}`
          );
          continue;
        }

        if (!payload || typeof payload !== "object") {
          errors.push(`${host}${chatPath}: invalid post-processing response payload`);
          continue;
        }

        const openAiChoices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
        const message = chatPath === "/api/chat"
          ? (payload as { message?: { content?: unknown } }).message
          : Array.isArray(openAiChoices)
            ? openAiChoices[0]?.message
            : undefined;
        const text = extractChatContentText(message?.content);
        if (!text) {
          errors.push(`${host}${chatPath}: post-processing response had no text`);
          continue;
        }

        return {
          text,
          metadata: {
            endpoint: `${host}${chatPath}`,
          },
        };
      } catch (error) {
        errors.push(
          `${host}${chatPath}: ${error instanceof Error ? error.message : "Request failed"}`
        );
      }
    }
  }

  throw new ApiRouteError(`Post-processing failed on Ollama: ${errors.join(" | ")}`, 502);
}

async function unloadOllamaModel(endpoint: string, model: string): Promise<void> {
  const candidates = getOllamaCandidatesForOcr(endpoint);
  for (const rawCandidate of candidates) {
    const host = normalizeOllamaApiBase(rawCandidate);
    try {
      await fetchWithTimeout(`${host}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: "",
          stream: false,
          keep_alive: 0,
        }),
      }, 10_000);
      return;
    } catch {
      // try next host candidate
    }
  }
}

async function warmupOllamaModel(endpoint: string, model: string): Promise<void> {
  const candidates = getOllamaCandidatesForOcr(endpoint);
  for (const rawCandidate of candidates) {
    const host = normalizeOllamaApiBase(rawCandidate);
    try {
      await fetchWithTimeout(`${host}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: "Warmup",
          stream: false,
          options: { num_predict: 1 },
          keep_alive: "10m",
        }),
      }, 15_000);
      return;
    } catch {
      // try next host candidate
    }
  }
}

function buildMistralChatEndpoint(rawEndpoint: string): string {
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

async function runMistralOcr(
  apiEndpoint: string,
  model: string,
  apiKey: string,
  preview: string,
  signal?: AbortSignal
): Promise<OcrRunResult> {
  if (!apiKey) {
    throw new ApiRouteError("MISTRAL_API_KEY is not configured", 500);
  }

  const endpointCandidates = buildMistralOcrEndpointCandidates(
    apiEndpoint || DEFAULT_MISTRAL_API_URL
  );
  let endpointUsed = endpointCandidates[0] || normalizeMistralEndpoint(DEFAULT_MISTRAL_API_URL);
  let payload: unknown = null;
  let response: Response | null = null;
  let lastError: ApiRouteError | null = null;

  for (let index = 0; index < endpointCandidates.length; index++) {
    const candidateEndpoint = endpointCandidates[index];
    endpointUsed = candidateEndpoint;
    let candidateResponse: Response;
    try {
      candidateResponse = await fetchWithTimeout(candidateEndpoint, {
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
      }, REQUEST_TIMEOUT_MS, signal);
    } catch (error) {
      if (error instanceof OcrStopRequestedError) {
        throw error;
      }
      throw error instanceof ApiRouteError
        ? error
        : new ApiRouteError(error instanceof Error ? error.message : "Mistral OCR request failed", 502);
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
          candidatePayload
        )}`,
        candidateResponse.status
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

async function runMistralPostProcessing(
  model: string,
  apiKey: string,
  apiEndpoint: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  if (!apiKey) {
    throw new ApiRouteError("MISTRAL_API_KEY is not configured", 500);
  }

  const endpoint = enforceProviderEndpointPolicy(
    "mistral",
    buildMistralChatEndpoint(apiEndpoint.trim() || DEFAULT_MISTRAL_API_URL),
    DEFAULT_MISTRAL_API_URL
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
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
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
      response.status
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

function normalizeMistralModels(): string[] {
  return [...new Set(DEFAULT_MISTRAL_MODELS)];
}

interface CompatProviderConfig {
  provider: Extract<ProviderKind, "openrouter" | "openai_compat">;
  label: string;
  defaultUrl: string;
  normalizeBase: (raw: string) => string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  buildDiscoveryHeaders: (apiKey: string) => Record<string, string>;
  modelCache: Map<string, { values: string[]; expiresAt: number }>;
  cacheTtlMs: number;
  cacheMaxEntries: number;
}

const OPENROUTER_CONFIG: CompatProviderConfig = {
  provider: "openrouter",
  label: "OpenRouter",
  defaultUrl: DEFAULT_OPENROUTER_API_URL,
  normalizeBase: normalizeOpenRouterApiBase,
  buildHeaders: (apiKey) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Title": OPENROUTER_TITLE,
    };
    if (OPENROUTER_REFERER) headers["HTTP-Referer"] = OPENROUTER_REFERER;
    return headers;
  },
  buildDiscoveryHeaders: (apiKey) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Title": OPENROUTER_TITLE,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (OPENROUTER_REFERER) headers["HTTP-Referer"] = OPENROUTER_REFERER;
    return headers;
  },
  modelCache: openRouterModelCache,
  cacheTtlMs: OPENROUTER_MODEL_CACHE_TTL_MS,
  cacheMaxEntries: OPENROUTER_MODEL_CACHE_MAX_ENTRIES,
};

const OPENAI_COMPAT_CONFIG: CompatProviderConfig = {
  provider: "openai_compat",
  label: "OpenAI-compatible",
  defaultUrl: DEFAULT_OPENAI_COMPAT_API_URL,
  normalizeBase: normalizeOpenAICompatApiBase,
  // Vanilla OpenAI shape: just Bearer auth + JSON. No X-Title, no HTTP-Referer
  // (those are OpenRouter-specific and confuse strict OpenAI servers).
  buildHeaders: (apiKey) => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  }),
  buildDiscoveryHeaders: (apiKey) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  },
  modelCache: openAICompatModelCache,
  cacheTtlMs: OPENAI_COMPAT_MODEL_CACHE_TTL_MS,
  cacheMaxEntries: OPENAI_COMPAT_MODEL_CACHE_MAX_ENTRIES,
};

function buildCompatEndpoint(
  cfg: CompatProviderConfig,
  rawEndpoint: string,
  suffix: "/chat/completions" | "/models"
): string {
  const base = cfg.normalizeBase(rawEndpoint || cfg.defaultUrl);
  return enforceProviderEndpointPolicy(cfg.provider, `${base}${suffix}`, `${cfg.defaultUrl}${suffix}`);
}

function buildCompatCacheKey(endpoint: string, apiKey: string): string {
  if (!apiKey) return `${endpoint}|anonymous`;
  const digest = createHash("sha256")
    .update(endpoint, "utf8")
    .update("|", "utf8")
    .update(apiKey, "utf8")
    .digest("hex");
  return `${endpoint}|${digest}`;
}

function pruneCompatModelCache(cfg: CompatProviderConfig): void {
  const now = Date.now();
  for (const [key, entry] of cfg.modelCache) {
    if (entry.expiresAt <= now) cfg.modelCache.delete(key);
  }
  while (cfg.modelCache.size > cfg.cacheMaxEntries) {
    const oldestKey = cfg.modelCache.keys().next().value;
    if (oldestKey === undefined) break;
    cfg.modelCache.delete(oldestKey);
  }
}

function getCachedCompatModels(cfg: CompatProviderConfig, endpoint: string, apiKey: string): string[] | null {
  const key = buildCompatCacheKey(endpoint, apiKey);
  const entry = cfg.modelCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cfg.modelCache.delete(key);
    return null;
  }
  cfg.modelCache.delete(key);
  cfg.modelCache.set(key, entry);
  return entry.values.length > 0 ? entry.values : null;
}

function setCompatModelCache(cfg: CompatProviderConfig, endpoint: string, apiKey: string, values: string[]): void {
  cfg.modelCache.set(buildCompatCacheKey(endpoint, apiKey), { values, expiresAt: Date.now() + cfg.cacheTtlMs });
  pruneCompatModelCache(cfg);
}

async function discoverCompatModels(cfg: CompatProviderConfig, apiEndpoint: string, apiKey: string): Promise<string[]> {
  const endpoint = buildCompatEndpoint(cfg, apiEndpoint, "/models");
  const cached = getCachedCompatModels(cfg, endpoint, apiKey);
  if (cached) return cached;

  const response = await fetchWithTimeout(endpoint, { headers: cfg.buildDiscoveryHeaders(apiKey) });
  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `${cfg.label} model discovery failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError(`Invalid ${cfg.label} model response`, 502);
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const models = data
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" ? id.trim() : "";
    })
    .filter(Boolean);

  const unique = Array.from(new Set(models));
  setCompatModelCache(cfg, endpoint, apiKey, unique);
  return unique;
}

async function runCompatOcr(
  cfg: CompatProviderConfig,
  apiEndpoint: string,
  model: string,
  apiKey: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal
): Promise<OcrRunResult> {
  if (!apiKey) {
    throw new ApiRouteError(`${cfg.label} API key is not configured`, 500);
  }

  const imageData = parsePreviewImageData(preview);
  if (!imageData.dataUrl) {
    throw new ApiRouteError(`Invalid image data for ${cfg.label} OCR`, 400);
  }

  const endpoint = buildCompatEndpoint(cfg, apiEndpoint, "/chat/completions");
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: cfg.buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageData.dataUrl } },
            ],
          },
        ],
        temperature: 0,
        stream: false,
      }),
    },
    REQUEST_TIMEOUT_MS,
    signal
  );

  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `${cfg.label} OCR failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError(`Invalid OCR response from ${cfg.label}`, 502);
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const message = Array.isArray(choices) ? choices[0]?.message : undefined;
  const text = extractChatContentText(message?.content);
  if (!text) {
    throw new ApiRouteError(`${cfg.label} OCR response had no text`, 502);
  }

  const parsed = parseJsonCandidate(text);
  const normalized = normalizeStructuredMarkdownPayload(parsed, text);
  if (!normalized.markdown) {
    throw new ApiRouteError(`${cfg.label} OCR response markdown was empty`, 502);
  }

  const usage = (payload as { usage?: Record<string, unknown> }).usage;
  return {
    text: normalized.markdown,
    structured: normalized.structured,
    metadata: { endpoint, outputFormat: normalized.parseMode, usage },
  };
}

async function runCompatPostProcessing(
  cfg: CompatProviderConfig,
  apiEndpoint: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  if (!apiKey) {
    throw new ApiRouteError(`${cfg.label} API key is not configured`, 500);
  }

  const endpoint = buildCompatEndpoint(cfg, apiEndpoint, "/chat/completions");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: cfg.buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(outputFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      temperature: 0,
      stream: false,
    }),
  });

  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `${cfg.label} post-processing failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError(`Invalid post-processing response from ${cfg.label}`, 502);
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const message = Array.isArray(choices) ? choices[0]?.message : undefined;
  const text = extractChatContentText(message?.content);
  if (!text) {
    throw new ApiRouteError(`${cfg.label} post-processing returned empty output`, 502);
  }

  return { text, metadata: { endpoint } };
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
  const mistralModels = normalizeMistralModels();

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

async function processOcrJobInBackground(input: ProcessOcrJobInput): Promise<void> {
  const startedAtIso = new Date(input.startedAtMs).toISOString();
  const pageOutputs: ProcessedPageOutput[] = input.initialPageOutputs ? [...input.initialPageOutputs] : [];
  const startIndex = Math.max(0, Math.min(input.startIndex ?? 0, input.inputPreviews.length));
  const checkpoints: OcrPageCheckpoint[] = pageOutputs.map(toPageCheckpoint);
  const pageRecords = pageOutputs.map(toPageRecord);
  const partialStructuredPages = pageOutputs.map(toStructuredPagePayload);
  const partialPageResults = pageOutputs.map(toPageResultPayload);
  let totalDurationMs = pageOutputs.reduce((sum, page) => sum + page.durationMs, 0);
  let extractedTextSoFar = "";
  let extractedChunkCount = 0;
  for (const page of pageOutputs) {
    const pageMarkdown = getPageMarkdownForRouting({
      pageNumber: page.pageNumber,
      text: page.text,
      structured: page.structured,
    }).trim();
    if (!pageMarkdown) {
      continue;
    }

    if (extractedChunkCount > 0) {
      extractedTextSoFar += "\n\n---\n\n";
    }
    extractedTextSoFar += pageMarkdown;
    extractedChunkCount += 1;
  }

  const selectedPostProcessModel = input.postProcessingPayload.model || input.model;
  const usedOllamaModels = new Set<string>();
  if (input.provider === "ollama") {
    usedOllamaModels.add(input.ocrModel);
  }

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

  let postProcessingMeta: OcrProgressMetadata["postProcessing"] = {
    enabled: input.postProcessingPayload.enabled,
    ...(input.postProcessingPayload.enabled
      ? {
          outputFormat: input.postProcessingPayload.outputFormat,
          instruction: input.postProcessingPayload.instruction,
          model: selectedPostProcessModel,
        }
      : {}),
  };

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

    for (const ollamaModel of usedOllamaModels) {
      await unloadOllamaModel(input.settings.apiEndpoint, ollamaModel);
    }

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

      const pageMarkdown = getPageMarkdownForRouting({
        pageNumber: completedPage.pageNumber,
        text: completedPage.text,
        structured: completedPage.structured,
      }).trim();
      if (pageMarkdown) {
        if (extractedChunkCount > 0) {
          extractedTextSoFar += "\n\n---\n\n";
        }
        extractedTextSoFar += pageMarkdown;
        extractedChunkCount += 1;
      }

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
    for (const ollamaModel of usedOllamaModels) {
      await unloadOllamaModel(input.settings.apiEndpoint, ollamaModel);
    }
    clearOcrJobRunning(input.jobId);
    await clearOcrJobStop(input.jobId);
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

    await db.ocrJob.update({
      where: { id: input.jobId },
      data: {
        status: OcrJobStatus.FAILED,
        metadata: toJsonValue(latestMetadata),
        errorMessage: error instanceof Error ? error.message : "OCR processing failed",
        completedAt: new Date(),
        processingMs: Date.now() - input.startedAtMs,
      },
    });
    void dispatchJobWebhooks(input.jobId, "job.failed").catch(() => undefined);
    for (const ollamaModel of usedOllamaModels) {
      await unloadOllamaModel(input.settings.apiEndpoint, ollamaModel);
    }
    clearOcrJobRunning(input.jobId);
    await clearOcrJobStop(input.jobId);
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

    const storedSettings = normalizeApiSettings(await getApiSettings(userId));
    const query = new URL(request.url).searchParams;
    const provider = normalizeProvider(query.get("provider") || undefined);
    const catalog = await getModelCatalog(storedSettings);
    return NextResponse.json({ success: true, models: catalog[provider] });
  } catch (error) {
    console.error("Model catalog error:", error);
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
      return NextResponse.json(
        {
          error: "Too many OCR jobs requested. Please retry shortly.",
          success: false,
        },
        {
          status: 429,
          headers: {
            "Retry-After": `${rateLimit.retryAfterSeconds}`,
          },
        }
      );
    }

    const storedSettings = normalizeApiSettings(await getApiSettings(userId));
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
    const status = error instanceof ApiRouteError
      ? error.status
      : error instanceof Error && error.name === "AbortError"
        ? 504
        : error instanceof TypeError
          ? 502
          : 500;
    const message =
      error instanceof Error ? error.message : "OCR processing failed";
    return NextResponse.json(
      {
        error: message,
        success: false,
      },
      { status }
    );
  }
}
