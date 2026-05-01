import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { chmod, chown, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { ApiProviderSettings, getApiSettings } from "@/lib/settings-store";
import { authenticateMutation, authHasScope, getAuthenticatedUserId } from "@/lib/auth/request";
import {
  maybeUploadResultJson,
  maybeUploadResultText,
} from "@/lib/result-store";
import { dispatchJobWebhooks } from "@/lib/webhooks";
import { db } from "@/lib/db";
import { enforceProviderEndpointPolicy } from "@/lib/endpoint-policy";
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

interface AdvancedSettings {
  language: string;
  tableDetection: boolean;
  handwritingRecognition: boolean;
  preserveFormatting: boolean;
  customPrompt: string;
  quality: number;
}

type PostProcessOutputFormat = "markdown" | "json";

interface PostProcessingSettings {
  enabled: boolean;
  instruction: string;
  outputFormat: PostProcessOutputFormat;
  model: string;
}

type OcrRunMode = "ocr" | "pdf_to_obsidian";

interface ObsidianSettings {
  enabled: boolean;
  vaultRoot: string;
  vaultNamePrefix: string;
  instruction: string;
  includePageNotes: boolean;
  model: string;
}

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
  mode?: unknown;
  obsidian?: Partial<ObsidianSettings>;
  provider?: unknown;
  apiEndpoint?: unknown;
  apiKey?: unknown;
  apiSettings?: {
    provider?: unknown;
    apiEndpoint?: unknown;
    apiKey?: unknown;
    obsidianBaseDir?: unknown;
  };
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
}

interface OcrJsonResult {
  fileName: string;
  extractedAt: string;
  provider: "ollama" | "mistral" | "openrouter";
  model: string;
  settings: AdvancedSettings;
  text: string;
  markdown: string;
  structured: Record<string, unknown>;
  metadata: {
    characterCount: number;
    wordCount: number;
    lineCount: number;
    provider: "ollama" | "mistral" | "openrouter";
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
    provider?: "ollama" | "mistral" | "openrouter";
    error?: string;
  };
}

interface ObsidianTopicNote {
  title: string;
  markdown: string;
  sourcePages: number[];
}

interface ObsidianPageContext {
  pageNumber: number;
  markdown: string;
  summary: string;
  keywords: string[];
  entities: string[];
}

interface ObsidianPagePlan extends ObsidianPageContext {
  title: string;
  primaryTopic: string;
  relatedTopics: string[];
}

interface ObsidianTopicPlan {
  name: string;
  summary: string;
  pageNumbers: number[];
  notes: ObsidianTopicNote[];
}

interface ObsidianVaultPlan {
  planVersion: 2;
  vaultName: string;
  markdown: string;
  indexMarkdown: string;
  topics: ObsidianTopicPlan[];
  pages: ObsidianPagePlan[];
}

interface ObsidianExportMetadata {
  enabled: boolean;
  requestedRoot: string;
  containerRoot: string;
  hostRoot?: string;
  vaultName?: string;
  vaultPath?: string;
  noteCount?: number;
  topicCount?: number;
  fileCount?: number;
  planVersion?: number;
  pageAssignmentCount?: number;
  unassignedPages?: number[];
  topics?: Array<{
    name: string;
    summary: string;
    pageNumbers: number[];
  }>;
  pages?: Array<{
    pageNumber: number;
    title?: string;
    summary: string;
    primaryTopic: string;
    relatedTopics: string[];
  }>;
}

class ApiRouteError extends Error {
  public status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiRouteError";
    this.status = status;
  }
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
const DEFAULT_MISTRAL_MODEL_SET = new Set(DEFAULT_MISTRAL_MODELS.map((id) => id.toLowerCase()));

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

const REQUEST_TIMEOUT_MS = 60_000;
const OLLAMA_MODEL_CACHE_TTL_MS = 60_000;
const MAX_STORED_PREVIEW_LENGTH = 1_500_000;
const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;
const MAX_OBSIDIAN_INSTRUCTION_LENGTH = 6000;
const MAX_OBSIDIAN_ROOT_LENGTH = 500;
const MAX_OBSIDIAN_TOPICS = 24;
const MAX_OBSIDIAN_KEYWORDS = 12;
const MAX_OBSIDIAN_ENTITIES = 8;
const MAX_OBSIDIAN_SUMMARY_LENGTH = 320;
const MAX_OBSIDIAN_PAGE_CONTEXT_CHARS = 2400;
const OCR_RATE_LIMIT_WINDOW_MS = 60_000;
const OCR_RATE_LIMIT_MAX = 6;
const OLLAMA_DISCOVERY_FALLBACK_HOST =
  APP_NETWORK_MODE === "host" ? "http://127.0.0.1:11434" : FALLBACK_OLLAMA_HOST;
const OLLAMA_DISCOVERY_PATHS = ["/api/tags", "/v1/models"] as const;
const OLLAMA_NETWORK_HINT =
  "If Ollama runs on the host machine, ensure it is bound to 0.0.0.0:11434 (not only 127.0.0.1), and from the container use a host-reachable address.";
const OBSIDIAN_EXPORT_BASE_DIR = (process.env.OBSIDIAN_EXPORT_BASE_DIR || "/host-vaults").trim();
const OBSIDIAN_EXPORT_HOST_ROOT = (process.env.OBSIDIAN_EXPORT_HOST_ROOT || "").trim();

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

type ProviderHint = "ollama" | "mistral" | "openrouter";

function parseProviderHint(rawProvider: string | undefined): ProviderHint {
  const value = rawProvider?.trim().toLowerCase().split(":")[0] || "ollama";
  if (value === "mistral") return "mistral";
  if (value === "openrouter") return "openrouter";
  return "ollama";
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

function normalizeApiSettings(raw: ApiProviderSettings): ApiProviderSettings {
  const provider = parseProviderHint(raw.provider);
  let normalizedEndpoint: string;
  if (provider === "mistral") {
    normalizedEndpoint = normalizeMistralOcrEndpoint(raw.apiEndpoint || DEFAULT_MISTRAL_API_URL);
  } else if (provider === "openrouter") {
    normalizedEndpoint = normalizeOpenRouterApiBase(raw.apiEndpoint || DEFAULT_OPENROUTER_API_URL);
  } else {
    normalizedEndpoint = resolveOllamaHostEndpoint(
      raw.apiEndpoint || OLLAMA_DISCOVERY_FALLBACK_HOST,
      OLLAMA_DISCOVERY_FALLBACK_HOST,
    );
  }

  let safeEndpoint: string;
  if (provider === "mistral") {
    safeEndpoint = enforceProviderEndpointPolicy("mistral", normalizedEndpoint, DEFAULT_MISTRAL_API_URL);
  } else if (provider === "openrouter") {
    safeEndpoint = enforceProviderEndpointPolicy(
      "openrouter",
      normalizedEndpoint,
      DEFAULT_OPENROUTER_API_URL
    );
  } else {
    safeEndpoint = enforceProviderEndpointPolicy("ollama", normalizedEndpoint, OLLAMA_DISCOVERY_FALLBACK_HOST);
  }

  return {
    provider,
    apiEndpoint: safeEndpoint,
    apiKey: raw.apiKey?.trim() || "",
    obsidianBaseDir: raw.obsidianBaseDir?.trim() || OBSIDIAN_EXPORT_BASE_DIR,
  };
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

function normalizeMistralOcrEndpoint(rawEndpoint: string): string {
  const fallback = DEFAULT_MISTRAL_API_URL;
  const trimmed = rawEndpoint.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = normalizeHostEndpoint(trimmed, fallback);
  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";

    const pathname = url.pathname.replace(/\/+$/u, "");
    if (pathname.endsWith("/v1/ocr")) {
      url.pathname = pathname;
      return url.toString();
    }
    if (pathname.endsWith("/v1/models")) {
      url.pathname = `${pathname.slice(0, -10)}/v1/ocr`;
      return url.toString();
    }
    if (pathname.endsWith("/models")) {
      const base = pathname.slice(0, -7);
      url.pathname = base.endsWith("/v1") ? `${base}/ocr` : `${base}/v1/ocr`;
      return url.toString();
    }
    if (pathname.endsWith("/ocr")) {
      const base = pathname.slice(0, -4);
      url.pathname = base.endsWith("/v1") ? `${base}/ocr` : `${base}/v1/ocr`;
      return url.toString();
    }
    if (pathname.endsWith("/v1")) {
      url.pathname = `${pathname}/ocr`;
      return url.toString();
    }
    if (!pathname || pathname === "/") {
      url.pathname = "/v1/ocr";
      return url.toString();
    }

    url.pathname = `${pathname}/v1/ocr`;
    return url.toString();
  } catch {
    return fallback;
  }
}

function buildMistralOcrEndpointCandidates(rawEndpoint: string): string[] {
  const baseEndpoint = normalizeMistralOcrEndpoint(rawEndpoint);
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

function sanitizeSettings(raw: Partial<AdvancedSettings> | undefined): AdvancedSettings {
  const safeQuality =
    typeof raw?.quality === "number" && Number.isFinite(raw.quality)
      ? Math.max(50, Math.min(100, Math.round(raw.quality / 10) * 10))
      : 80;

  return {
    language: typeof raw?.language === "string" && raw.language.trim() ? raw.language.trim() : "auto",
    tableDetection: typeof raw?.tableDetection === "boolean" ? raw.tableDetection : true,
    handwritingRecognition:
      typeof raw?.handwritingRecognition === "boolean" ? raw.handwritingRecognition : false,
    preserveFormatting: typeof raw?.preserveFormatting === "boolean" ? raw.preserveFormatting : true,
    customPrompt: typeof raw?.customPrompt === "string" ? raw.customPrompt.trim() : "",
    quality: safeQuality,
  };
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

function parseRunMode(raw: unknown): OcrRunMode {
  return typeof raw === "string" && raw.trim().toLowerCase() === "pdf_to_obsidian"
    ? "pdf_to_obsidian"
    : "ocr";
}

function sanitizeObsidianSettings(raw: Partial<ObsidianSettings> | undefined): ObsidianSettings {
  const vaultRoot = typeof raw?.vaultRoot === "string" ? raw.vaultRoot.trim() : "";
  const vaultNamePrefix =
    typeof raw?.vaultNamePrefix === "string" ? raw.vaultNamePrefix.trim() : "";
  const instruction = typeof raw?.instruction === "string" ? raw.instruction.trim() : "";
  const model = typeof raw?.model === "string" ? raw.model.trim() : "";

  return {
    enabled: Boolean(raw?.enabled),
    vaultRoot: vaultRoot.slice(0, MAX_OBSIDIAN_ROOT_LENGTH),
    vaultNamePrefix: vaultNamePrefix.slice(0, 120),
    instruction: instruction.slice(0, MAX_OBSIDIAN_INSTRUCTION_LENGTH),
    includePageNotes: typeof raw?.includePageNotes === "boolean" ? raw.includePageNotes : true,
    model,
  };
}

function toSlugSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "note";
}

function sanitizeFileSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = cleaned || fallback;
  return normalized.slice(0, 120);
}

function buildObsidianVaultName(
  fileName: string,
  prefix: string,
  timestamp = new Date()
): string {
  const fileStem = fileName.replace(/\.[^/.]+$/u, "").trim() || "document";
  const datePart = [
    timestamp.getFullYear().toString(),
    String(timestamp.getMonth() + 1).padStart(2, "0"),
    String(timestamp.getDate()).padStart(2, "0"),
  ].join("-");
  const base = prefix ? `${prefix}-${fileStem}` : fileStem;
  return sanitizeFileSegment(`${base}-${datePart}`, "extracto-vault");
}

function isLikelyMistralModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized.startsWith("mistral") ||
    normalized.includes("pixtral") ||
    normalized.includes("ocr")
  );
}

function isLikelyMistralOcrModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.includes("ocr");
}

function resolveMistralOcrModel(selectedModel: string): string {
  return isLikelyMistralOcrModel(selectedModel) ? selectedModel : DEFAULT_MISTRAL_OCR_MODEL;
}

function isLikelyOllamaModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized.includes(":") ||
    normalized.startsWith("llava") ||
    normalized.includes("llama") ||
    normalized.includes("minicpm")
  );
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

function buildObsidianPostProcessingInstruction(customInstruction: string): string {
  const userInstruction = customInstruction.trim()
    ? `Additional user instruction:\n${customInstruction.trim()}\n\n`
    : "";

  return [
    "Transform OCR output into an Obsidian-ready knowledge structure.",
    "Use all pages and infer coherent topics with page-level routing.",
    userInstruction,
    "Return ONLY valid JSON with this exact schema:",
    "{",
    '  "markdown": "merged markdown for the entire document",',
    '  "vault": {',
    '    "name": "short vault name",',
    '    "topics": [',
    "      {",
    '        "name": "topic name",',
    '        "summary": "topic summary",',
    '        "pageNumbers": [1, 2]',
    "      }",
    "    ],",
    '    "pages": [',
    "      {",
    '        "pageNumber": 1,',
    '        "title": "generated page title",',
    '        "summary": "2-3 sentence page summary",',
    '        "primaryTopic": "topic name from vault.topics",',
    '        "relatedTopics": ["another topic"],',
    '        "keywords": ["keyword"],',
    '        "entities": ["Entity Name"]',
    "      }",
    "    ]",
    "  }",
    "}",
    "",
    "Rules:",
    '- "markdown" must always be present.',
    '- Every page must appear exactly once in "vault.pages".',
    '- Every page must have exactly one "primaryTopic".',
    '- Every page must have a concise title suitable as a note filename.',
    '- "primaryTopic" and "relatedTopics" must reference existing topic names.',
    '- Keep summaries short (2-3 sentences).',
    "- Do not wrap JSON in markdown code fences.",
  ].join("\n");
}

function parseSourcePages(value: unknown, maxPageNumber = Number.MAX_SAFE_INTEGER): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "number" ? Math.floor(entry) : NaN))
        .filter((entry) => Number.isFinite(entry) && entry > 0 && entry <= maxPageNumber)
    )
  ).sort((a, b) => a - b);
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getStringArray(value: unknown, maxItems = MAX_OBSIDIAN_KEYWORDS): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const values = value
    .map((entry) => getString(entry))
    .filter(Boolean);

  return Array.from(new Set(values)).slice(0, maxItems);
}

function makeUniqueMarkdownFileName(baseName: string, used: Set<string>): string {
  const baseSlug = toSlugSegment(baseName);
  let attempt = `${baseSlug}.md`;
  let counter = 2;
  while (used.has(attempt)) {
    attempt = `${baseSlug}-${counter}.md`;
    counter += 1;
  }
  used.add(attempt);
  return attempt;
}

const COMMON_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "if", "in",
  "into", "is", "it", "its", "of", "on", "or", "that", "the", "their", "there", "this", "to",
  "was", "were", "will", "with", "without", "not", "but", "you", "your", "we", "our", "they",
  "them", "his", "her", "she", "he", "also", "than", "then", "can", "could", "should", "would",
  "about", "after", "before", "over", "under", "between", "during", "using", "used", "use",
  "page", "pages", "document", "section", "table", "figure", "chapter",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clipText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractKeywordsFromText(text: string, maxItems = MAX_OBSIDIAN_KEYWORDS): string[] {
  const frequencies = new Map<string, number>();
  const tokenMatches = text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [];
  for (const token of tokenMatches) {
    const cleaned = token.replace(/^[-']+|[-']+$/g, "");
    if (!cleaned || COMMON_STOP_WORDS.has(cleaned)) {
      continue;
    }
    frequencies.set(cleaned, (frequencies.get(cleaned) || 0) + 1);
  }

  return Array.from(frequencies.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, maxItems)
    .map(([keyword]) => keyword);
}

function extractEntitiesFromText(text: string, maxItems = MAX_OBSIDIAN_ENTITIES): string[] {
  const entities = new Set<string>();
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || [];
  for (const candidate of matches) {
    const normalized = normalizeWhitespace(candidate);
    if (!normalized || normalized.length < 3) {
      continue;
    }
    entities.add(normalized);
    if (entities.size >= maxItems) {
      break;
    }
  }
  return Array.from(entities);
}

function buildPageSummary(markdown: string): string {
  const plain = normalizeWhitespace(
    markdown
      .replace(/[`*_>#\-]/g, " ")
      .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
      .replace(/\|/g, " ")
  );
  if (!plain) {
    return "No meaningful text extracted from this page.";
  }

  const sentenceCandidates = plain.match(/[^.!?]+[.!?]?/g) || [plain];
  const picked: string[] = [];
  let totalLength = 0;
  for (const sentence of sentenceCandidates) {
    const normalized = normalizeWhitespace(sentence);
    if (!normalized) {
      continue;
    }
    if (picked.length >= 3) {
      break;
    }
    const projected = totalLength + normalized.length + (picked.length > 0 ? 1 : 0);
    if (projected > MAX_OBSIDIAN_SUMMARY_LENGTH && picked.length > 0) {
      break;
    }
    picked.push(normalized);
    totalLength = projected;
  }

  if (picked.length === 0) {
    return clipText(plain, MAX_OBSIDIAN_SUMMARY_LENGTH);
  }
  return clipText(picked.join(" "), MAX_OBSIDIAN_SUMMARY_LENGTH);
}

function derivePageTitle(input: {
  pageNumber: number;
  summary: string;
  markdown: string;
  topicName: string;
  preferredTitle?: string;
}): string {
  const normalizeTitleCandidate = (value: string): string => {
    const cleaned = sanitizeFileSegment(
      value
        .replace(/^#+\s*/u, "")
        .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
        .replace(/[`*_>#|]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
      ""
    );
    return clipText(cleaned, 90);
  };

  const preferred = normalizeTitleCandidate(input.preferredTitle || "");
  if (preferred && !/^page\s+\d+$/iu.test(preferred)) {
    return preferred;
  }

  const headingMatch = input.markdown.match(/^\s{0,3}#{1,6}\s+([^\n]+)/m);
  const fromHeading = normalizeTitleCandidate(headingMatch?.[1] || "");
  if (fromHeading) {
    return fromHeading;
  }

  const sentenceSource = input.summary || input.markdown;
  const firstSentenceMatch = sentenceSource.match(/[^.!?\n]+[.!?]?/u);
  const fromSentence = normalizeTitleCandidate(firstSentenceMatch?.[0] || "");
  if (
    fromSentence &&
    !/^no meaningful text extracted/iu.test(fromSentence)
  ) {
    return fromSentence;
  }

  return sanitizeFileSegment(`${input.topicName} Page ${input.pageNumber}`, `Page ${input.pageNumber}`);
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

function buildPageIntelligence(
  pages: Array<{
    pageNumber: number;
    text: string;
    structured: Record<string, unknown>;
  }>
): ObsidianPageContext[] {
  return pages
    .map((page) => {
      const markdown = getPageMarkdownForRouting(page);
      const summary = buildPageSummary(markdown);
      return {
        pageNumber: page.pageNumber,
        markdown,
        summary,
        keywords: extractKeywordsFromText(`${summary}\n${markdown}`, MAX_OBSIDIAN_KEYWORDS),
        entities: extractEntitiesFromText(markdown, MAX_OBSIDIAN_ENTITIES),
      } satisfies ObsidianPageContext;
    })
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

function formatPageRoutingContext(pages: ObsidianPageContext[]): string {
  return pages
    .map((page) => {
      const clippedMarkdown = page.markdown.length > MAX_OBSIDIAN_PAGE_CONTEXT_CHARS
        ? `${page.markdown.slice(0, MAX_OBSIDIAN_PAGE_CONTEXT_CHARS).trimEnd()}\n[truncated]`
        : page.markdown;
      const keywordLine = page.keywords.length ? page.keywords.join(", ") : "none";
      const entityLine = page.entities.length ? page.entities.join(", ") : "none";
      return [
        `[PAGE ${page.pageNumber}]`,
        `Summary: ${page.summary}`,
        `Keywords: ${keywordLine}`,
        `Entities: ${entityLine}`,
        "Markdown:",
        clippedMarkdown,
        `[END PAGE ${page.pageNumber}]`,
      ].join("\n");
    })
    .join("\n\n");
}

function resolveTopicNameCandidate(candidate: string, availableTopics: string[]): string | null {
  const normalized = candidate.trim();
  if (!normalized) {
    return null;
  }

  const exactMatch = availableTopics.find(
    (topicName) => topicName.toLowerCase() === normalized.toLowerCase()
  );
  if (exactMatch) {
    return exactMatch;
  }

  const candidateSlug = toSlugSegment(normalized);
  const slugMatch = availableTopics.find((topicName) => toSlugSegment(topicName) === candidateSlug);
  return slugMatch || null;
}

function parseTopicNotes(
  rawValue: unknown,
  topicName: string,
  maxPageNumber: number
): ObsidianTopicNote[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((note, noteIndex) => {
      if (!note || typeof note !== "object" || Array.isArray(note)) {
        return null;
      }
      const noteObject = note as Record<string, unknown>;
      const noteMarkdown = coerceMarkdownText(
        noteObject.markdown ?? noteObject.text ?? noteObject.content,
        ""
      );
      if (!noteMarkdown.trim()) {
        return null;
      }
      return {
        title: sanitizeFileSegment(getString(noteObject.title), `${topicName} ${noteIndex + 1}`),
        markdown: noteMarkdown,
        sourcePages: parseSourcePages(noteObject.sourcePages, maxPageNumber),
      } satisfies ObsidianTopicNote;
    })
    .filter((note): note is ObsidianTopicNote => Boolean(note));
}

function scoreTopicForPage(page: ObsidianPageContext, topic: ObsidianTopicPlan): number {
  const topicText = `${topic.name} ${topic.summary}`.trim();
  if (!topicText) {
    return 0;
  }

  const topicLower = topicText.toLowerCase();
  const topicKeywords = new Set(extractKeywordsFromText(topicText, MAX_OBSIDIAN_KEYWORDS * 2));
  let score = 0;

  if (page.summary.toLowerCase().includes(topic.name.toLowerCase())) {
    score += 6;
  }
  if (topic.pageNumbers.includes(page.pageNumber)) {
    score += 8;
  }
  for (const keyword of page.keywords) {
    if (topicKeywords.has(keyword)) {
      score += 2;
    }
  }
  for (const entity of page.entities) {
    if (topicLower.includes(entity.toLowerCase())) {
      score += 1;
    }
  }

  return score;
}

function buildGeneratedObsidianIndex(topics: ObsidianTopicPlan[], pages: ObsidianPagePlan[]): string {
  return [
    "# Topics",
    "",
    ...topics.flatMap((topic) => {
      const assignedPages = pages.filter((page) => page.primaryTopic === topic.name);
      const section: string[] = [
        `## ${topic.name}`,
        topic.summary || "_No summary available._",
      ];
      if (assignedPages.length > 0) {
        section.push("- Pages in topic:");
        for (const page of assignedPages) {
          section.push(`  - ${page.title} (page ${page.pageNumber})`);
        }
      }
      section.push("");
      return section;
    }),
  ]
    .join("\n")
    .trim();
}

function normalizeObsidianPlan(
  rawJson: unknown,
  fallbackMarkdown: string,
  fileName: string,
  vaultNamePrefix: string,
  pageContexts: ObsidianPageContext[]
): ObsidianVaultPlan {
  const fallbackText = fallbackMarkdown.trim();
  const fallbackVaultName = buildObsidianVaultName(fileName, vaultNamePrefix);
  const pageNumberSet = new Set(pageContexts.map((page) => page.pageNumber));
  const maxPageNumber = pageContexts.reduce((max, page) => Math.max(max, page.pageNumber), 0);
  const rootObject =
    rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)
      ? (rawJson as Record<string, unknown>)
      : {};
  const pageMarkdownFallback = pageContexts
    .map((page) => page.markdown.trim())
    .filter(Boolean)
    .join(pageContexts.length > 1 ? "\n\n---\n\n" : "\n");
  const markdown = coerceMarkdownText(rootObject.markdown, fallbackText || pageMarkdownFallback);
  const vaultObject =
    rootObject.vault && typeof rootObject.vault === "object" && !Array.isArray(rootObject.vault)
      ? (rootObject.vault as Record<string, unknown>)
      : {};
  const vaultName = sanitizeFileSegment(getString(vaultObject.name), fallbackVaultName);
  const rawTopics = Array.isArray(vaultObject.topics) ? vaultObject.topics : [];
  const rawPages = Array.isArray(vaultObject.pages)
    ? vaultObject.pages
    : Array.isArray(rootObject.pages)
      ? rootObject.pages
      : [];

  const topicMap = new Map<string, ObsidianTopicPlan>();
  const topicOrder: string[] = [];
  const upsertTopic = (
    nameValue: string,
    summaryValue: string,
    pageNumbersValue: number[],
    notesValue: ObsidianTopicNote[]
  ): string | null => {
    const sanitizedName = sanitizeFileSegment(nameValue, "Inbox");
    const key = toSlugSegment(sanitizedName);
    const existing = topicMap.get(key);
    if (existing) {
      if (!existing.summary && summaryValue) {
        existing.summary = clipText(summaryValue, MAX_OBSIDIAN_SUMMARY_LENGTH);
      }
      existing.pageNumbers = Array.from(new Set([...existing.pageNumbers, ...pageNumbersValue]))
        .filter((pageNumber) => pageNumberSet.has(pageNumber))
        .sort((a, b) => a - b);
      existing.notes = [...existing.notes, ...notesValue];
      return existing.name;
    }
    if (topicMap.size >= MAX_OBSIDIAN_TOPICS) {
      return null;
    }
    topicMap.set(key, {
      name: sanitizedName,
      summary: clipText(summaryValue, MAX_OBSIDIAN_SUMMARY_LENGTH),
      pageNumbers: pageNumbersValue,
      notes: notesValue,
    });
    topicOrder.push(key);
    return sanitizedName;
  };

  rawTopics.forEach((topic, topicIndex) => {
      if (!topic || typeof topic !== "object" || Array.isArray(topic)) {
        return;
      }
      const topicObject = topic as Record<string, unknown>;
      const topicName = getString(topicObject.name) || `Topic ${topicIndex + 1}`;
      const pageNumbers = parseSourcePages(
        topicObject.pageNumbers ?? topicObject.sourcePages,
        maxPageNumber
      );
      const noteListRaw = Array.isArray(topicObject.notes)
        ? topicObject.notes
        : Array.isArray(topicObject.files)
          ? topicObject.files
          : [];
      const notes = parseTopicNotes(noteListRaw, topicName, maxPageNumber);
      upsertTopic(topicName, getString(topicObject.summary), pageNumbers, notes);
    });

  const topics: ObsidianTopicPlan[] = topicOrder
    .map((key) => topicMap.get(key))
    .filter((topic): topic is ObsidianTopicPlan => Boolean(topic));

  const ensureTopic = (candidateName: string, fallbackName = "Inbox"): string => {
    const availableNames = topics.map((topic) => topic.name);
    const resolved = resolveTopicNameCandidate(candidateName, availableNames);
    if (resolved) {
      return resolved;
    }
    const sanitized = sanitizeFileSegment(candidateName || fallbackName, fallbackName);
    const existing = resolveTopicNameCandidate(sanitized, availableNames);
    if (existing) {
      return existing;
    }
    const createdName = upsertTopic(sanitized, "", [], []);
    if (!createdName) {
      return topics[0]?.name || "Inbox";
    }
    const createdTopic = topicMap.get(toSlugSegment(createdName));
    if (createdTopic) {
      topics.push(createdTopic);
    }
    return createdName;
  };

  const pageOverrideMap = new Map<number, {
    title: string;
    summary: string;
    primaryTopic: string;
    relatedTopics: string[];
    keywords: string[];
    entities: string[];
    markdown: string;
  }>();

  for (const rawPage of rawPages) {
    if (!rawPage || typeof rawPage !== "object" || Array.isArray(rawPage)) {
      continue;
    }
    const typedPage = rawPage as Record<string, unknown>;
    const pageNumber = typeof typedPage.pageNumber === "number"
      ? Math.floor(typedPage.pageNumber)
      : typeof typedPage.page === "number"
        ? Math.floor(typedPage.page)
        : NaN;
    if (!Number.isFinite(pageNumber) || pageNumber <= 0 || !pageNumberSet.has(pageNumber)) {
      continue;
    }
    pageOverrideMap.set(pageNumber, {
      title: clipText(getString(typedPage.title), 90),
      summary: clipText(getString(typedPage.summary), MAX_OBSIDIAN_SUMMARY_LENGTH),
      primaryTopic: getString(typedPage.primaryTopic),
      relatedTopics: getStringArray(typedPage.relatedTopics, 8),
      keywords: getStringArray(typedPage.keywords, MAX_OBSIDIAN_KEYWORDS),
      entities: getStringArray(typedPage.entities, MAX_OBSIDIAN_ENTITIES),
      markdown: coerceMarkdownText(
        typedPage.markdown ?? typedPage.text ?? typedPage.content,
        ""
      ),
    });
  }

  if (topics.length === 0) {
    upsertTopic("Inbox", "", [], []);
    const inbox = topicMap.get("inbox");
    if (inbox) {
      topics.push(inbox);
    }
  }

  const pages: ObsidianPagePlan[] = pageContexts.map((page) => {
    const override = pageOverrideMap.get(page.pageNumber);
    const summary = override?.summary || page.summary;
    const markdownValue = override?.markdown || page.markdown;
    const keywords = override?.keywords.length ? override.keywords : page.keywords;
    const entities = override?.entities.length ? override.entities : page.entities;

    let primaryTopic = override?.primaryTopic || "";
    if (!primaryTopic) {
      const topicFromPageList = topics.find((topic) => topic.pageNumbers.includes(page.pageNumber));
      if (topicFromPageList) {
        primaryTopic = topicFromPageList.name;
      }
    }
    if (!primaryTopic) {
      let bestTopic = topics[0]?.name || "Inbox";
      let bestScore = Number.NEGATIVE_INFINITY;
      const scoringPage: ObsidianPageContext = {
        pageNumber: page.pageNumber,
        markdown: markdownValue,
        summary,
        keywords,
        entities,
      };
      for (const topic of topics) {
        const score = scoreTopicForPage(scoringPage, topic);
        if (score > bestScore) {
          bestScore = score;
          bestTopic = topic.name;
        }
      }
      primaryTopic = bestScore > 0 ? bestTopic : "Inbox";
    }
    primaryTopic = ensureTopic(primaryTopic, "Inbox");

    const relatedCandidates = [
      ...(override?.relatedTopics || []),
      ...topics
        .filter((topic) => topic.name !== primaryTopic && topic.pageNumbers.includes(page.pageNumber))
        .map((topic) => topic.name),
    ];
    const relatedTopics = Array.from(
      new Set(
        relatedCandidates
          .map((name) => ensureTopic(name, primaryTopic))
          .filter((name) => name && name !== primaryTopic)
      )
    ).slice(0, 6);
    const title = derivePageTitle({
      pageNumber: page.pageNumber,
      summary,
      markdown: markdownValue,
      topicName: primaryTopic,
      preferredTitle: override?.title,
    });

    return {
      pageNumber: page.pageNumber,
      title,
      markdown: markdownValue.trim(),
      summary,
      keywords,
      entities,
      primaryTopic,
      relatedTopics,
    } satisfies ObsidianPagePlan;
  });

  const topicPagesMap = new Map<string, Set<number>>();
  for (const topic of topics) {
    topicPagesMap.set(topic.name, new Set<number>());
  }
  for (const page of pages) {
    if (!topicPagesMap.has(page.primaryTopic)) {
      topicPagesMap.set(page.primaryTopic, new Set<number>());
    }
    topicPagesMap.get(page.primaryTopic)?.add(page.pageNumber);
  }
  for (const topic of topics) {
    const declaredPages = topic.pageNumbers.filter((pageNumber) => pageNumberSet.has(pageNumber));
    const assigned = topicPagesMap.get(topic.name) || new Set<number>();
    for (const pageNumber of declaredPages) {
      assigned.add(pageNumber);
    }
    topic.pageNumbers = Array.from(assigned).sort((a, b) => a - b);
    topic.summary = clipText(topic.summary, MAX_OBSIDIAN_SUMMARY_LENGTH);
  }

  const generatedIndex = buildGeneratedObsidianIndex(topics, pages);

  return {
    planVersion: 2,
    vaultName,
    markdown,
    indexMarkdown: getString(vaultObject.indexMarkdown) || generatedIndex,
    topics,
    pages,
  };
}

function resolveObsidianRootPath(requestedRoot: string): {
  requestedRoot: string;
  containerRoot: string;
  hostRoot?: string;
} {
  const safeBaseDir = path.resolve(OBSIDIAN_EXPORT_BASE_DIR || "/host-vaults");
  const hostRootRaw = OBSIDIAN_EXPORT_HOST_ROOT.trim();
  const hostRootAbsolute = hostRootRaw ? path.resolve(hostRootRaw) : "";
  const trimmedRoot = requestedRoot.trim();

  let containerRoot = safeBaseDir;
  if (trimmedRoot) {
    if (path.isAbsolute(trimmedRoot)) {
      if (
        hostRootAbsolute &&
        (trimmedRoot === hostRootAbsolute || trimmedRoot.startsWith(`${hostRootAbsolute}${path.sep}`))
      ) {
        const relativeFromHost = path.relative(hostRootAbsolute, trimmedRoot);
        containerRoot = path.resolve(path.join(safeBaseDir, relativeFromHost));
      } else if (
        trimmedRoot === safeBaseDir ||
        trimmedRoot.startsWith(`${safeBaseDir}${path.sep}`)
      ) {
        containerRoot = path.resolve(trimmedRoot);
      } else {
        throw new ApiRouteError(
          `Vault root must be inside ${hostRootAbsolute || safeBaseDir}`,
          400
        );
      }
    } else {
      containerRoot = path.resolve(path.join(safeBaseDir, trimmedRoot));
    }
  }

  if (
    containerRoot !== safeBaseDir &&
    !containerRoot.startsWith(`${safeBaseDir}${path.sep}`)
  ) {
    throw new ApiRouteError(`Vault root must be inside ${safeBaseDir}`, 400);
  }

  const relativeFromBase = path.relative(safeBaseDir, containerRoot);
  const hostDisplayRoot = hostRootAbsolute
    ? path.join(hostRootAbsolute, relativeFromBase)
    : undefined;

  return {
    requestedRoot: trimmedRoot || safeBaseDir,
    containerRoot,
    hostRoot: hostDisplayRoot,
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const maxWorkers = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: maxWorkers }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex]);
      }
    })
  );
}

async function writeObsidianVault(input: {
  plan: ObsidianVaultPlan;
  fileName: string;
  requestedRoot: string;
}): Promise<{
  vaultPath: string;
  hostVaultPath?: string;
  topicCount: number;
  noteCount: number;
  fileCount: number;
  pageAssignmentCount: number;
  unassignedPages: number[];
  topics: Array<{ name: string; summary: string; pageNumbers: number[] }>;
}> {
  const serializeYamlStringList = (values: string[]): string =>
    values.length
      ? `[${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(", ")}]`
      : "[]";

  const root = resolveObsidianRootPath(input.requestedRoot);
  const safeBaseDir = path.resolve(OBSIDIAN_EXPORT_BASE_DIR || "/host-vaults");
  const vaultPath = path.join(root.containerRoot, input.plan.vaultName);
  const hostVaultPath = root.hostRoot
    ? path.join(root.hostRoot, input.plan.vaultName)
    : undefined;
  const createdDirs: string[] = [];
  const createdFiles: string[] = [];

  const ensureDir = async (target: string) => {
    await mkdir(target, { recursive: true });
    createdDirs.push(target);
  };

  const writeVaultFile = async (target: string, contents: string) => {
    await writeFile(target, contents, "utf8");
    createdFiles.push(target);
  };

  const ownership = await (async () => {
    try {
      const info = await stat(safeBaseDir);
      if (typeof info.uid === "number" && typeof info.gid === "number") {
        return { uid: info.uid, gid: info.gid };
      }
    } catch {
      // ignore
    }
    return null;
  })();

  await ensureDir(vaultPath);

  const usedNamesByFolder = new Map<string, Set<string>>();
  const pagesByTopic = new Map<string, ObsidianPagePlan[]>();
  for (const topic of input.plan.topics) {
    pagesByTopic.set(
      topic.name,
      input.plan.pages
        .filter((page) => page.primaryTopic === topic.name)
        .sort((a, b) => a.pageNumber - b.pageNumber)
    );
  }

  let noteCount = 0;
  let fileCount = 0;
  const pendingWrites: Array<{ target: string; contents: string }> = [];

  for (const topic of input.plan.topics) {
    const topicDirName = sanitizeFileSegment(topic.name, "topic");
    const topicDirPath = path.join(vaultPath, topicDirName);
    const topicPages = pagesByTopic.get(topic.name) || [];
    if (topicPages.length === 0) {
      continue;
    }

    await ensureDir(topicDirPath);
    const used = usedNamesByFolder.get(topicDirPath) || new Set<string>();
    usedNamesByFolder.set(topicDirPath, used);

    for (const page of topicPages) {
      const fallbackTitle = derivePageTitle({
        pageNumber: page.pageNumber,
        summary: page.summary,
        markdown: page.markdown,
        topicName: topic.name,
        preferredTitle: page.title,
      });
      const pageFileName = makeUniqueMarkdownFileName(fallbackTitle, used);
      const pagePath = path.join(topicDirPath, pageFileName);
      const pageContent = [
        "---",
        `title: "${fallbackTitle.replace(/"/g, '\\"')}"`,
        `source_file: "${input.fileName.replace(/"/g, '\\"')}"`,
        `page: ${page.pageNumber}`,
        `topic: "${topic.name.replace(/"/g, '\\"')}"`,
        `related_topics: ${serializeYamlStringList(page.relatedTopics)}`,
        `summary: "${clipText(page.summary, MAX_OBSIDIAN_SUMMARY_LENGTH).replace(/"/g, '\\"')}"`,
        `keywords: ${serializeYamlStringList(page.keywords)}`,
        `entities: ${serializeYamlStringList(page.entities)}`,
        "---",
        "",
        page.markdown.trim(),
        "",
      ].join("\n");
      pendingWrites.push({
        target: pagePath,
        contents: pageContent,
      });
      noteCount += 1;
      fileCount += 1;
    }
  }

  await runWithConcurrency(pendingWrites, 8, async (item) => {
    await writeVaultFile(item.target, item.contents);
  });

  const unassignedPages = input.plan.pages
    .filter((page) => !page.primaryTopic || !pagesByTopic.has(page.primaryTopic))
    .map((page) => page.pageNumber)
    .sort((a, b) => a - b);
  const exportedTopics = input.plan.topics
    .filter((topic) => (pagesByTopic.get(topic.name) || []).length > 0)
    .map((topic) => ({
      name: topic.name,
      summary: topic.summary,
      pageNumbers: topic.pageNumbers,
    }));

  let chownApplied = false;
  if (ownership) {
    await runWithConcurrency(createdDirs, 16, async (dirPath) => {
      try {
        await chown(dirPath, ownership.uid, ownership.gid);
        chownApplied = true;
      } catch {
        // ignore and fallback below
      }
    });
    await runWithConcurrency(createdFiles, 16, async (filePath) => {
      try {
        await chown(filePath, ownership.uid, ownership.gid);
        chownApplied = true;
      } catch {
        // ignore and fallback below
      }
    });
  }

  if (!chownApplied) {
    await runWithConcurrency(createdDirs, 16, async (dirPath) => {
      try {
        await chmod(dirPath, 0o777);
      } catch {
        // ignore
      }
    });
    await runWithConcurrency(createdFiles, 16, async (filePath) => {
      try {
        await chmod(filePath, 0o666);
      } catch {
        // ignore
      }
    });
  }

  return {
    vaultPath,
    hostVaultPath,
    topicCount: exportedTopics.length,
    noteCount,
    fileCount,
    pageAssignmentCount: input.plan.pages.length - unassignedPages.length,
    unassignedPages,
    topics: exportedTopics,
  };
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
  const safeText = text.trim();
  return {
    characterCount: text.length,
    wordCount: safeText ? safeText.split(/\s+/).filter(Boolean).length : 0,
    lineCount: safeText ? safeText.split("\n").filter(Boolean).length : 0,
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

function extractFirstBalancedJsonObject(input: string): string | null {
  let depth = 0;
  let startIndex = -1;
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === "\\") {
        escapeNext = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && startIndex >= 0) {
          return input.slice(startIndex, index + 1);
        }
      }
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

function extractMarkdownFromJsonLikeText(raw: string): string | null {
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/```$/u, "")
    .replace(/^json\s*/iu, "");

  const keyMatch = /"markdown"\s*:/iu.exec(normalized);
  if (!keyMatch) {
    return null;
  }

  const valueSlice = normalized.slice(keyMatch.index + keyMatch[0].length).trimStart();
  if (!valueSlice.startsWith("\"")) {
    return null;
  }

  const fieldMatch = /^"([\s\S]*?)"\s*(?:,\s*"[\w$-]+"\s*:|\}\s*$)/u.exec(valueSlice);
  if (!fieldMatch?.[1]) {
    return null;
  }

  const decoded = fieldMatch[1]
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\")
    .trim();

  return decoded || null;
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
  provider: "ollama" | "mistral" | "openrouter",
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

async function resolveOllamaEndpoint(endpoint: string): Promise<string> {
  const result = await getOllamaModels(endpoint);
  return result.host;
}

async function resolveProvider(
  model: string,
  settings: ApiProviderSettings
): Promise<"ollama" | "mistral" | "openrouter"> {
  const normalizedModel = model.trim();
  const providerHint = parseProviderHint(settings.provider);
  if (!normalizedModel) {
    throw new ApiRouteError("Model is required", 400);
  }

  if (providerHint === "mistral") {
    return "mistral";
  }

  if (providerHint === "openrouter") {
    return "openrouter";
  }

  if (providerHint === "ollama") {
    return "ollama";
  }

  if (DEFAULT_MISTRAL_MODEL_SET.has(normalizedModel.toLowerCase())) {
    return "mistral";
  }

  if (isLikelyMistralModel(normalizedModel)) {
    return "mistral";
  }

  if (isLikelyOpenRouterModel(normalizedModel)) {
    return "openrouter";
  }

  try {
    const availableModels = await getOllamaModels(settings.apiEndpoint);
    if (availableModels.models.includes(normalizedModel)) {
      return "ollama";
    }
  } catch (error) {
    if (isLikelyOllamaModel(normalizedModel)) {
      return "ollama";
    }
    throw error instanceof ApiRouteError
      ? error
      : new ApiRouteError(`Cannot resolve provider for model "${normalizedModel}"`, 502);
  }

  if (isLikelyOllamaModel(normalizedModel)) {
    return "ollama";
  }

  throw new ApiRouteError(`Model "${normalizedModel}" is not available on this backend`, 400);
}

async function runOllamaOcr(
  endpoint: string,
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal
): Promise<{ text: string; structured: Record<string, unknown>; metadata: Record<string, unknown> }> {
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
    resolvedHost = await resolveOllamaEndpoint(endpoint);
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
  model: string,
  preview: string,
  apiKey: string,
  apiEndpoint: string,
  signal?: AbortSignal
): Promise<{ text: string; structured: Record<string, unknown>; metadata: Record<string, unknown> }> {
  if (!apiKey) {
    throw new ApiRouteError("MISTRAL_API_KEY is not configured", 500);
  }

  const endpointCandidates = buildMistralOcrEndpointCandidates(
    apiEndpoint || DEFAULT_MISTRAL_API_URL
  );
  let endpointUsed = endpointCandidates[0] || normalizeMistralOcrEndpoint(DEFAULT_MISTRAL_API_URL);
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

function buildOpenRouterEndpoint(rawEndpoint: string, suffix: "/chat/completions" | "/models"): string {
  const base = normalizeOpenRouterApiBase(rawEndpoint || DEFAULT_OPENROUTER_API_URL);
  return enforceProviderEndpointPolicy(
    "openrouter",
    `${base}${suffix}`,
    `${DEFAULT_OPENROUTER_API_URL}${suffix}`
  );
}

function buildOpenRouterCacheKey(endpoint: string, apiKey: string): string {
  if (!apiKey) {
    return `${endpoint}|anonymous`;
  }
  const digest = createHash("sha256")
    .update(endpoint, "utf8")
    .update("|", "utf8")
    .update(apiKey, "utf8")
    .digest("hex");
  return `${endpoint}|${digest}`;
}

function pruneOpenRouterModelCache() {
  const now = Date.now();
  for (const [key, entry] of openRouterModelCache) {
    if (entry.expiresAt <= now) {
      openRouterModelCache.delete(key);
    }
  }
  while (openRouterModelCache.size > OPENROUTER_MODEL_CACHE_MAX_ENTRIES) {
    const oldestKey = openRouterModelCache.keys().next().value;
    if (oldestKey === undefined) break;
    openRouterModelCache.delete(oldestKey);
  }
}

function getCachedOpenRouterModels(endpoint: string, apiKey: string): string[] | null {
  const cacheKey = buildOpenRouterCacheKey(endpoint, apiKey);
  const entry = openRouterModelCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    openRouterModelCache.delete(cacheKey);
    return null;
  }
  openRouterModelCache.delete(cacheKey);
  openRouterModelCache.set(cacheKey, entry);
  return entry.values.length > 0 ? entry.values : null;
}

function setOpenRouterModelCache(endpoint: string, apiKey: string, values: string[]) {
  openRouterModelCache.set(buildOpenRouterCacheKey(endpoint, apiKey), {
    values,
    expiresAt: Date.now() + OPENROUTER_MODEL_CACHE_TTL_MS,
  });
  pruneOpenRouterModelCache();
}

function isLikelyOpenRouterModel(model: string): boolean {
  const lowered = model.trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes("/") &&
    /^[a-z0-9_.+-]+\/[a-z0-9_.+:-]+$/i.test(lowered) &&
    !lowered.startsWith("ollama/") &&
    !lowered.startsWith("mistral/")
  );
}

function buildOpenRouterHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Title": OPENROUTER_TITLE,
  };
  if (OPENROUTER_REFERER) {
    headers["HTTP-Referer"] = OPENROUTER_REFERER;
  }
  return headers;
}

async function discoverOpenRouterModels(
  apiEndpoint: string,
  apiKey: string
): Promise<string[]> {
  const endpoint = buildOpenRouterEndpoint(apiEndpoint, "/models");
  const cached = getCachedOpenRouterModels(endpoint, apiKey);
  if (cached) {
    return cached;
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Title": OPENROUTER_TITLE,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (OPENROUTER_REFERER) {
    headers["HTTP-Referer"] = OPENROUTER_REFERER;
  }

  const response = await fetchWithTimeout(endpoint, { headers });
  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `OpenRouter model discovery failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Invalid OpenRouter model response", 502);
  }

  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }

  const models = data
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const id = (entry as { id?: unknown }).id;
      return typeof id === "string" ? id.trim() : "";
    })
    .filter(Boolean);

  const unique = Array.from(new Set(models));
  setOpenRouterModelCache(endpoint, apiKey, unique);
  return unique;
}

async function runOpenRouterOcr(
  apiEndpoint: string,
  model: string,
  apiKey: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal
): Promise<{ text: string; structured: Record<string, unknown>; metadata: Record<string, unknown> }> {
  if (!apiKey) {
    throw new ApiRouteError("OpenRouter API key is not configured", 500);
  }

  const imageData = parsePreviewImageData(preview);
  if (!imageData.dataUrl) {
    throw new ApiRouteError("Invalid image data for OpenRouter OCR", 400);
  }

  const endpoint = buildOpenRouterEndpoint(apiEndpoint, "/chat/completions");
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: buildOpenRouterHeaders(apiKey),
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
      `OpenRouter OCR failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Invalid OCR response from OpenRouter", 502);
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const message = Array.isArray(choices) ? choices[0]?.message : undefined;
  const text = extractChatContentText(message?.content);
  if (!text) {
    throw new ApiRouteError("OpenRouter OCR response had no text", 502);
  }

  const parsed = parseJsonCandidate(text);
  const normalized = normalizeStructuredMarkdownPayload(parsed, text);
  if (!normalized.markdown) {
    throw new ApiRouteError("OpenRouter OCR response markdown was empty", 502);
  }

  const usage = (payload as { usage?: Record<string, unknown> }).usage;
  return {
    text: normalized.markdown,
    structured: normalized.structured,
    metadata: {
      endpoint,
      outputFormat: normalized.parseMode,
      usage,
    },
  };
}

async function runOpenRouterPostProcessing(
  apiEndpoint: string,
  model: string,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  outputFormat: PostProcessOutputFormat
): Promise<{ text: string; metadata: Record<string, unknown> }> {
  if (!apiKey) {
    throw new ApiRouteError("OpenRouter API key is not configured", 500);
  }

  const endpoint = buildOpenRouterEndpoint(apiEndpoint, "/chat/completions");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: buildOpenRouterHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(outputFormat === "json"
        ? { response_format: { type: "json_object" } }
        : {}),
      temperature: 0,
      stream: false,
    }),
  });

  const payload = await parseResponseText(response);
  if (!response.ok) {
    throw new ApiRouteError(
      `OpenRouter post-processing failed (${response.status}): ${parseServiceError(response, payload)}`,
      response.status
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new ApiRouteError("Invalid post-processing response from OpenRouter", 502);
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const message = Array.isArray(choices) ? choices[0]?.message : undefined;
  const text = extractChatContentText(message?.content);
  if (!text) {
    throw new ApiRouteError("OpenRouter post-processing returned empty output", 502);
  }

  return {
    text,
    metadata: { endpoint },
  };
}

async function getModelCatalog(settings: ApiProviderSettings): Promise<ModelCatalog> {
  const mistralModels = normalizeMistralModels();
  let ollamaModels: string[] = [];
  let openRouterModels: string[] = [];

  try {
    const discovered = await getOllamaModels(settings.apiEndpoint);
    ollamaModels = discovered.models;
  } catch (error) {
    console.error("Failed to fetch Ollama model catalog:", error);
  }

  try {
    const endpointForDiscovery =
      settings.provider === "openrouter" ? settings.apiEndpoint : DEFAULT_OPENROUTER_API_URL;
    const apiKeyForDiscovery =
      settings.provider === "openrouter"
        ? settings.apiKey || process.env.OPENROUTER_API_KEY || ""
        : process.env.OPENROUTER_API_KEY || "";
    if (apiKeyForDiscovery) {
      openRouterModels = await discoverOpenRouterModels(endpointForDiscovery, apiKeyForDiscovery);
    }
  } catch (error) {
    console.error("Failed to fetch OpenRouter model catalog:", error);
  }

  if (openRouterModels.length === 0 && settings.provider === "openrouter") {
    openRouterModels = [...DEFAULT_OPENROUTER_FALLBACK_MODELS];
  }

  return {
    ollama: ollamaModels,
    mistral: mistralModels,
    openrouter: openRouterModels,
  };
}

interface ProcessOcrJobInput {
  jobId: string;
  startedAtMs: number;
  fileName: string;
  model: string;
  ocrModel: string;
  provider: "ollama" | "mistral" | "openrouter";
  mode: OcrRunMode;
  settings: ApiProviderSettings;
  settingsPayload: AdvancedSettings;
  postProcessingPayload: PostProcessingSettings;
  obsidianPayload: ObsidianSettings;
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

function toCheckpointPage(page: ProcessedPageOutput) {
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
  const isObsidianMode = input.mode === "pdf_to_obsidian";
  const startedAtIso = new Date(input.startedAtMs).toISOString();
  const pageOutputs: ProcessedPageOutput[] = input.initialPageOutputs ? [...input.initialPageOutputs] : [];
  const startIndex = Math.max(0, Math.min(input.startIndex ?? 0, input.inputPreviews.length));
  const checkpoints: OcrPageCheckpoint[] = pageOutputs.map(toPageCheckpoint);
  const checkpointPages = pageOutputs.map(toCheckpointPage);
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
  let obsidianMeta: ObsidianExportMetadata = {
    enabled: isObsidianMode,
    requestedRoot: input.obsidianPayload.vaultRoot,
    containerRoot: OBSIDIAN_EXPORT_BASE_DIR,
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
          checkpointPages,
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
        if (input.provider === "ollama") {
          ({ text: pageText, structured: pageStructured, metadata: pageMetadata } = await runOllamaOcr(
            input.settings.apiEndpoint,
            input.ocrModel,
            input.prompt,
            pagePreview,
            pageAbortController.signal
          ));
        } else if (input.provider === "openrouter") {
          const openRouterEndpoint =
            input.settings.provider === "openrouter"
              ? input.settings.apiEndpoint
              : DEFAULT_OPENROUTER_API_URL;
          ({ text: pageText, structured: pageStructured, metadata: pageMetadata } = await runOpenRouterOcr(
            openRouterEndpoint,
            input.ocrModel,
            input.settings.apiKey || process.env.OPENROUTER_API_KEY || "",
            input.prompt,
            pagePreview,
            pageAbortController.signal
          ));
        } else {
          const mistralEndpoint =
            input.settings.provider === "mistral"
              ? input.settings.apiEndpoint
              : DEFAULT_MISTRAL_API_URL;
          ({ text: pageText, structured: pageStructured, metadata: pageMetadata } = await runMistralOcr(
            input.ocrModel,
            pagePreview,
            input.settings.apiKey || process.env.MISTRAL_API_KEY || "",
            mistralEndpoint,
            pageAbortController.signal
          ));
        }
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
      checkpointPages.push(toCheckpointPage(completedPage));
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
            checkpointPages,
          }),
        },
      });
    }

    const extractedMarkdown = extractedTextSoFar.trim();
    if (!extractedMarkdown.trim()) {
      throw new ApiRouteError("OCR returned no text", 502);
    }

    const pageIntelligence = buildPageIntelligence(
      pageOutputs.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.text,
        structured: page.structured,
      }))
    );
    const pageScopedText = formatPageScopedText(pageOutputs);
    const extractedMetadata: Record<string, unknown> = {
      mode: input.mode,
      ocrModel: input.ocrModel,
      inferenceModel: input.model,
      pageCount: input.inputPreviews.length,
      pageResults: partialPageResults,
      pageIntelligence,
    };
    let finalMarkdown = extractedMarkdown;
    let postProcessedJson: unknown = undefined;
    let postProcessedText: string | undefined;

    if (input.postProcessingPayload.enabled) {
      const postProcessingModel = selectedPostProcessModel;
      const postProcessingProvider = await resolveProvider(postProcessingModel, input.settings);
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
        isObsidianMode
          ? "OCR page intelligence and page markdown grouped by page:"
          : "OCR source text grouped by page:",
        isObsidianMode ? formatPageRoutingContext(pageIntelligence) : pageScopedText,
      ].join("\n");

      try {
        let postProcessResult: { text: string; metadata: Record<string, unknown> };
        if (postProcessingProvider === "ollama") {
          postProcessResult = await runOllamaPostProcessing(
            input.settings.apiEndpoint,
            postProcessingModel,
            systemPrompt,
            postProcessRequestText
          );
        } else if (postProcessingProvider === "openrouter") {
          postProcessResult = await runOpenRouterPostProcessing(
            input.settings.provider === "openrouter"
              ? input.settings.apiEndpoint
              : DEFAULT_OPENROUTER_API_URL,
            postProcessingModel,
            input.settings.apiKey || process.env.OPENROUTER_API_KEY || "",
            systemPrompt,
            postProcessRequestText,
            input.postProcessingPayload.outputFormat
          );
        } else {
          postProcessResult = await runMistralPostProcessing(
            postProcessingModel,
            input.settings.apiKey || process.env.MISTRAL_API_KEY || "",
            input.settings.provider === "mistral"
              ? input.settings.apiEndpoint
              : DEFAULT_MISTRAL_API_URL,
            systemPrompt,
            postProcessRequestText,
            input.postProcessingPayload.outputFormat
          );
        }

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

    if (isObsidianMode) {
      progressEvents = appendProgressEvent(
        progressEvents,
        "exporting",
        "Generating Obsidian vault structure"
      );
      latestMetadata = buildProgressMetadata({
        stage: "exporting",
        message: "Preparing Obsidian vault export",
        progressPct: 96,
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

      const parsedObsidianJson =
        postProcessedJson !== undefined
          ? postProcessedJson
          : postProcessedText
            ? parseJsonCandidate(postProcessedText)
            : null;
      const plan = normalizeObsidianPlan(
        parsedObsidianJson,
        finalMarkdown || extractedMarkdown,
        input.fileName,
        input.obsidianPayload.vaultNamePrefix,
        pageIntelligence
      );
      if (plan.markdown.trim()) {
        finalMarkdown = plan.markdown.trim();
      }

      const exportOutput = await writeObsidianVault({
        plan,
        fileName: input.fileName,
        requestedRoot: input.obsidianPayload.vaultRoot,
      });

      obsidianMeta = {
        enabled: true,
        requestedRoot: input.obsidianPayload.vaultRoot,
        containerRoot: path.dirname(exportOutput.vaultPath),
        hostRoot: exportOutput.hostVaultPath
          ? path.dirname(exportOutput.hostVaultPath)
          : undefined,
        vaultName: path.basename(exportOutput.vaultPath),
        vaultPath: exportOutput.hostVaultPath || exportOutput.vaultPath,
        topicCount: exportOutput.topicCount,
        noteCount: exportOutput.noteCount,
        fileCount: exportOutput.fileCount,
        planVersion: plan.planVersion,
        pageAssignmentCount: exportOutput.pageAssignmentCount,
        unassignedPages: exportOutput.unassignedPages,
        topics: exportOutput.topics,
        pages: plan.pages.map((page) => ({
          pageNumber: page.pageNumber,
          title: page.title,
          summary: page.summary,
          primaryTopic: page.primaryTopic,
          relatedTopics: page.relatedTopics,
        })),
      };
      extractedMetadata.obsidian = obsidianMeta;
    } else {
      extractedMetadata.obsidian = {
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
        obsidian: obsidianMeta,
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
      ? (metadata as { checkpointPages?: unknown }).checkpointPages
      : undefined;
  const fromResult = result && typeof result === "object" && !Array.isArray(result)
    ? (result as { metadata?: { checkpointPages?: unknown } }).metadata?.checkpointPages
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
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      throw new ApiRouteError("Unauthorized", 401);
    }

    const storedSettings = normalizeApiSettings(await getApiSettings(userId));
    const query = new URL(request.url).searchParams;
    const provider = parseProviderHint(query.get("provider") || undefined);
    const catalog = await getModelCatalog(storedSettings);

    if (provider === "ollama") {
      return NextResponse.json({ success: true, models: catalog.ollama });
    }

    if (provider === "mistral") {
      return NextResponse.json({ success: true, models: catalog.mistral });
    }

    if (provider === "openrouter") {
      return NextResponse.json({ success: true, models: catalog.openrouter });
    }

    return NextResponse.json({ success: true, models: catalog });
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
    if (!authHasScope(auth, "ocr:submit")) {
      throw new ApiRouteError("Missing required scope: ocr:submit", 403);
    }
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
    const settingsPayload = sanitizeSettings(body.settings);
    const mode = parseRunMode(body.mode);
    const obsidianPayload = sanitizeObsidianSettings(body.obsidian);
    let postProcessingPayload = sanitizePostProcessing(body.postProcessing);
    const settings = normalizeApiSettings(storedSettings);
    const effectiveObsidianPayload: ObsidianSettings = {
      ...obsidianPayload,
      enabled: mode === "pdf_to_obsidian",
      vaultRoot:
        obsidianPayload.vaultRoot.trim() || settings.obsidianBaseDir || OBSIDIAN_EXPORT_BASE_DIR,
    };
    if (mode === "pdf_to_obsidian") {
      const obsidianModel = effectiveObsidianPayload.model || postProcessingPayload.model || model;
      postProcessingPayload = {
        enabled: true,
        instruction: buildObsidianPostProcessingInstruction(effectiveObsidianPayload.instruction),
        outputFormat: "json",
        model: obsidianModel,
      };
    }

    if (!model) {
      throw new ApiRouteError("Model is required", 400);
    }

    if (inputPreviews.length === 0) {
      throw new ApiRouteError("No image preview provided", 400);
    }

    const resumeRequested = body.resume === true || body.resume === "true";
    const resumeJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";

    const provider = await resolveProvider(model, settings);
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
        message:
          mode === "pdf_to_obsidian"
            ? `Resume requested for PDF→Obsidian from page ${startIndex + 1}/${inputPreviews.length}`
            : `Resume requested from page ${startIndex + 1}/${inputPreviews.length}`,
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
            mode,
            obsidian: effectiveObsidianPayload,
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
          mode,
          settings,
          settingsPayload,
          postProcessingPayload,
          obsidianPayload: effectiveObsidianPayload,
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
          checkpointPages: startIndex,
        },
        { status: 202 }
      );
    }

    const initialMetadata = buildProgressMetadata({
      stage: "queued",
      message: mode === "pdf_to_obsidian" ? "Queued for PDF→Obsidian" : "Queued for OCR",
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
          mode,
          obsidian: effectiveObsidianPayload,
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
        mode,
        settings,
        settingsPayload,
        postProcessingPayload,
        obsidianPayload: effectiveObsidianPayload,
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
