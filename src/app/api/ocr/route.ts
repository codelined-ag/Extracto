import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus, Prisma } from "@prisma/client";
import { chmod, chown, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { ApiProviderSettings, getApiSettings } from "@/lib/settings-store";
import { getAuthCookieName, verifySessionToken } from "@/lib/auth/token";
import { db } from "@/lib/db";
import {
  clearOcrJobRunning,
  clearOcrJobStop,
  isOcrJobStopRequested,
  markOcrJobRunning,
  registerOcrJobAbortController,
  unregisterOcrJobAbortController,
} from "@/lib/ocr/job-control";
import {
  buildOllamaHostCandidates,
  normalizeHostEndpoint,
  resolveOllamaHostEndpoint,
} from "@/lib/host-normalization";

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

interface OcrPage {
  index?: number;
  markdown?: string;
  text?: string;
  html?: string;
}

interface ModelCatalog {
  ollama: string[];
  mistral: string[];
}

interface OcrJsonResult {
  fileName: string;
  extractedAt: string;
  provider: "ollama" | "mistral";
  model: string;
  settings: AdvancedSettings;
  text: string;
  markdown: string;
  structured: Record<string, unknown>;
  metadata: {
    characterCount: number;
    wordCount: number;
    lineCount: number;
    provider: "ollama" | "mistral";
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
    provider?: "ollama" | "mistral";
    error?: string;
  };
}

interface ObsidianTopicNote {
  title: string;
  markdown: string;
  sourcePages: number[];
}

interface ObsidianTopicPlan {
  name: string;
  summary: string;
  notes: ObsidianTopicNote[];
}

interface ObsidianVaultPlan {
  vaultName: string;
  markdown: string;
  indexMarkdown: string;
  topics: ObsidianTopicPlan[];
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

const REQUEST_TIMEOUT_MS = 60_000;
const OLLAMA_MODEL_CACHE_TTL_MS = 60_000;
const MAX_STORED_PREVIEW_LENGTH = 1_500_000;
const MAX_POST_PROCESS_INSTRUCTION_LENGTH = 6000;
const MAX_OBSIDIAN_INSTRUCTION_LENGTH = 6000;
const MAX_OBSIDIAN_ROOT_LENGTH = 500;
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

interface OllamaModelCatalogResult {
  models: string[];
  host: string;
}

function getOllamaHostCandidates(rawEndpoint: string): string[] {
  return buildOllamaHostCandidates(rawEndpoint, OLLAMA_DISCOVERY_FALLBACK_HOST);
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
  return candidates;
}

function parseProviderHint(rawProvider: string | undefined): string {
  return rawProvider?.trim().toLowerCase().split(":")[0] || "ollama";
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

async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(getAuthCookieName())?.value;
  const payload = await verifySessionToken(token);
  return payload?.userId ?? null;
}

function normalizeApiSettings(raw: ApiProviderSettings): ApiProviderSettings {
  const provider = parseProviderHint(raw.provider);
  return {
    provider,
    apiEndpoint:
      provider === "mistral"
        ? normalizeMistralOcrEndpoint(raw.apiEndpoint || DEFAULT_MISTRAL_API_URL)
        : resolveOllamaHostEndpoint(
            raw.apiEndpoint || OLLAMA_DISCOVERY_FALLBACK_HOST,
            OLLAMA_DISCOVERY_FALLBACK_HOST,
          ),
    apiKey: raw.apiKey?.trim() || "",
    obsidianBaseDir: raw.obsidianBaseDir?.trim() || OBSIDIAN_EXPORT_BASE_DIR,
  };
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
  return Array.from(new Set([withoutProcess, withProcess]));
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
    "Use all pages and infer coherent topics.",
    userInstruction,
    "Return ONLY valid JSON with this exact schema:",
    "{",
    '  "markdown": "merged markdown for the entire document",',
    '  "vault": {',
    '    "name": "short vault name",',
    '    "indexMarkdown": "top-level index note in markdown",',
    '    "topics": [',
    "      {",
    '        "name": "topic name",',
    '        "summary": "topic summary",',
    '        "notes": [',
    "          {",
    '            "title": "note title",',
    '            "markdown": "note markdown content",',
    '            "sourcePages": [1, 2]',
    "          }",
    "        ]",
    "      }",
    "    ]",
    "  }",
    "}",
    "",
    "Rules:",
    '- "markdown" must always be present.',
    '- Keep "sourcePages" to real page numbers only.',
    "- Do not wrap JSON in markdown code fences.",
  ].join("\n");
}

function parseSourcePages(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "number" ? Math.floor(entry) : NaN))
        .filter((entry) => Number.isFinite(entry) && entry > 0)
    )
  ).sort((a, b) => a - b);
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function normalizeObsidianPlan(
  rawJson: unknown,
  fallbackMarkdown: string,
  fileName: string,
  vaultNamePrefix: string
): ObsidianVaultPlan {
  const fallbackText = fallbackMarkdown.trim();
  const fallbackVaultName = buildObsidianVaultName(fileName, vaultNamePrefix);
  const rootObject =
    rawJson && typeof rawJson === "object" && !Array.isArray(rawJson)
      ? (rawJson as Record<string, unknown>)
      : {};
  const markdown = coerceMarkdownText(rootObject.markdown, fallbackText);
  const vaultObject =
    rootObject.vault && typeof rootObject.vault === "object" && !Array.isArray(rootObject.vault)
      ? (rootObject.vault as Record<string, unknown>)
      : {};
  const vaultName = sanitizeFileSegment(getString(vaultObject.name), fallbackVaultName);
  const rawTopics = Array.isArray(vaultObject.topics) ? vaultObject.topics : [];

  const normalizedTopics: ObsidianTopicPlan[] = rawTopics
    .map((topic, topicIndex) => {
      if (!topic || typeof topic !== "object" || Array.isArray(topic)) {
        return null;
      }
      const topicObject = topic as Record<string, unknown>;
      const topicName = sanitizeFileSegment(
        getString(topicObject.name),
        `Topic ${topicIndex + 1}`
      );
      const topicSummary = getString(topicObject.summary);
      const noteListRaw = Array.isArray(topicObject.notes)
        ? topicObject.notes
        : Array.isArray(topicObject.files)
          ? topicObject.files
          : [];
      const notes = noteListRaw
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
          const noteTitle = sanitizeFileSegment(
            getString(noteObject.title),
            `${topicName} ${noteIndex + 1}`
          );
          const sourcePages = parseSourcePages(noteObject.sourcePages);
          return {
            title: noteTitle,
            markdown: noteMarkdown,
            sourcePages,
          } satisfies ObsidianTopicNote;
        })
        .filter((note): note is ObsidianTopicNote => Boolean(note));

      if (notes.length === 0) {
        return null;
      }

      return {
        name: topicName,
        summary: topicSummary,
        notes,
      } satisfies ObsidianTopicPlan;
    })
    .filter((topic): topic is ObsidianTopicPlan => Boolean(topic));

  const topics = normalizedTopics.length > 0
    ? normalizedTopics
    : [
        {
          name: "General",
          summary: "",
          notes: [
            {
              title: sanitizeFileSegment(fileName.replace(/\.[^/.]+$/u, ""), "Document"),
              markdown,
              sourcePages: [],
            },
          ],
        },
      ];

  const generatedIndex = [
    "# Vault Index",
    "",
    ...topics.flatMap((topic) => {
      const heading = `## ${topic.name}`;
      const summaryLine = topic.summary ? `${topic.summary}\n` : "";
      const links = topic.notes.map((note) => `- [[${note.title}]]`);
      return [heading, summaryLine, ...links, ""];
    }),
  ]
    .join("\n")
    .trim();

  return {
    vaultName,
    markdown,
    indexMarkdown: getString(vaultObject.indexMarkdown) || generatedIndex,
    topics,
  };
}

function resolveObsidianRootPath(requestedRoot: string): {
  requestedRoot: string;
  containerRoot: string;
  hostRoot?: string;
} {
  const safeBaseDir = path.resolve(OBSIDIAN_EXPORT_BASE_DIR || "/host-vaults");
  const hostRootRaw = OBSIDIAN_EXPORT_HOST_ROOT.trim();
  const hostRootAbsolute =
    hostRootRaw && path.isAbsolute(hostRootRaw) ? path.resolve(hostRootRaw) : "";
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
    : hostRootRaw
      ? [hostRootRaw.replace(/[\\/]+$/u, ""), relativeFromBase.replace(/\\/g, "/")]
          .filter(Boolean)
          .join("/")
      : undefined;

  return {
    requestedRoot: trimmedRoot || safeBaseDir,
    containerRoot,
    hostRoot: hostDisplayRoot,
  };
}

async function writeObsidianVault(input: {
  plan: ObsidianVaultPlan;
  fileName: string;
  requestedRoot: string;
  includePageNotes: boolean;
  pageOutputs: Array<{ pageNumber: number; text: string }>;
}): Promise<{
  vaultPath: string;
  hostVaultPath?: string;
  topicCount: number;
  noteCount: number;
  fileCount: number;
}> {
  const root = resolveObsidianRootPath(input.requestedRoot);
  const safeBaseDir = path.resolve(OBSIDIAN_EXPORT_BASE_DIR || "/host-vaults");
  const vaultPath = path.join(root.containerRoot, input.plan.vaultName);
  const hostVaultPath = root.hostRoot
    ? path.join(root.hostRoot, input.plan.vaultName)
    : undefined;

  const topicRoot = path.join(vaultPath, "01 Topics");
  const pageRoot = path.join(vaultPath, "02 Pages");
  const rawRoot = path.join(vaultPath, "03 Raw");
  const indexRoot = path.join(vaultPath, "00 Index");
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
  await ensureDir(path.join(vaultPath, ".obsidian"));
  await ensureDir(topicRoot);
  await ensureDir(pageRoot);
  await ensureDir(rawRoot);
  await ensureDir(indexRoot);

  await writeVaultFile(
    path.join(vaultPath, ".obsidian", "app.json"),
    JSON.stringify({ }, null, 2),
  );
  await writeVaultFile(path.join(indexRoot, "Home.md"), `${input.plan.indexMarkdown.trim()}\n`);
  await writeVaultFile(
    path.join(rawRoot, "Full OCR.md"),
    `${input.plan.markdown.trim()}\n`,
  );

  const usedNamesByFolder = new Map<string, Set<string>>();
  let noteCount = 0;
  let fileCount = 3;

  for (const topic of input.plan.topics) {
    const topicDirName = sanitizeFileSegment(topic.name, "topic");
    const topicDirPath = path.join(topicRoot, topicDirName);
    await ensureDir(topicDirPath);
    fileCount += 1;

    const used = usedNamesByFolder.get(topicDirPath) || new Set<string>();
    usedNamesByFolder.set(topicDirPath, used);

    for (const note of topic.notes) {
      const noteFileName = makeUniqueMarkdownFileName(note.title, used);
      const notePath = path.join(topicDirPath, noteFileName);
      const sourcePagesLine = note.sourcePages.length
        ? `source_pages: [${note.sourcePages.join(", ")}]\n`
        : "";
      const noteContent = [
        "---",
        `title: "${note.title.replace(/"/g, '\\"')}"`,
        `source_file: "${input.fileName.replace(/"/g, '\\"')}"`,
        sourcePagesLine.trimEnd(),
        "---",
        "",
        note.markdown.trim(),
        "",
      ]
        .filter((line) => line.length > 0)
        .join("\n");
      await writeVaultFile(notePath, noteContent);
      noteCount += 1;
      fileCount += 1;
    }
  }

  if (input.includePageNotes) {
    for (const page of input.pageOutputs) {
      const pagePath = path.join(
        pageRoot,
        `Page-${String(page.pageNumber).padStart(3, "0")}.md`
      );
      const pageContent = [
        "---",
        `source_file: "${input.fileName.replace(/"/g, '\\"')}"`,
        `page: ${page.pageNumber}`,
        "---",
        "",
        page.text.trim(),
        "",
      ].join("\n");
      await writeVaultFile(pagePath, pageContent);
      fileCount += 1;
    }
  }

  let chownApplied = false;
  if (ownership) {
    for (const dirPath of createdDirs) {
      try {
        await chown(dirPath, ownership.uid, ownership.gid);
        chownApplied = true;
      } catch {
        // ignore and fallback below
      }
    }
    for (const filePath of createdFiles) {
      try {
        await chown(filePath, ownership.uid, ownership.gid);
        chownApplied = true;
      } catch {
        // ignore and fallback below
      }
    }
  }

  if (!chownApplied) {
    for (const dirPath of createdDirs) {
      try {
        await chmod(dirPath, 0o777);
      } catch {
        // ignore
      }
    }
    for (const filePath of createdFiles) {
      try {
        await chmod(filePath, 0o666);
      } catch {
        // ignore
      }
    }
  }

  return {
    vaultPath,
    hostVaultPath,
    topicCount: input.plan.topics.length,
    noteCount,
    fileCount,
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
  provider: "ollama" | "mistral",
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

  for (const rawCandidate of candidates) {
    const host = normalizeOllamaApiBase(rawCandidate);
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
): Promise<"ollama" | "mistral"> {
  const normalizedModel = model.trim();
  const providerHint = parseProviderHint(settings.provider);
  if (!normalizedModel) {
    throw new ApiRouteError("Model is required", 400);
  }

  if (providerHint === "mistral") {
    return "mistral";
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

  const endpoint = buildMistralChatEndpoint(
    apiEndpoint.trim() || DEFAULT_MISTRAL_API_URL
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

async function getModelCatalog(settings: ApiProviderSettings): Promise<ModelCatalog> {
  const mistralModels = normalizeMistralModels();
  let ollamaModels: string[] = [];

  try {
    const discovered = await getOllamaModels(settings.apiEndpoint);
    ollamaModels = discovered.models;
  } catch (error) {
    console.error("Failed to fetch Ollama model catalog:", error);
  }

  return {
    ollama: ollamaModels,
    mistral: mistralModels,
  };
}

interface ProcessOcrJobInput {
  jobId: string;
  startedAtMs: number;
  fileName: string;
  model: string;
  provider: "ollama" | "mistral";
  mode: OcrRunMode;
  settings: ApiProviderSettings;
  settingsPayload: AdvancedSettings;
  postProcessingPayload: PostProcessingSettings;
  obsidianPayload: ObsidianSettings;
  inputPreviews: string[];
  prompt: string;
  initialPageOutputs?: Array<{
    pageNumber: number;
    text: string;
    structured: Record<string, unknown>;
    metadata: Record<string, unknown>;
    durationMs: number;
  }>;
  startIndex?: number;
  resumed?: boolean;
}

async function processOcrJobInBackground(input: ProcessOcrJobInput): Promise<void> {
  const isObsidianMode = input.mode === "pdf_to_obsidian";
  const startedAtIso = new Date(input.startedAtMs).toISOString();
  const pageOutputs: Array<{
    pageNumber: number;
    text: string;
    structured: Record<string, unknown>;
    metadata: Record<string, unknown>;
    durationMs: number;
  }> = input.initialPageOutputs ? [...input.initialPageOutputs] : [];
  const startIndex = Math.max(0, Math.min(input.startIndex ?? 0, input.inputPreviews.length));
  const selectedPostProcessModel = input.postProcessingPayload.model || input.model;
  const usedOllamaModels = new Set<string>();
  if (input.provider === "ollama") {
    usedOllamaModels.add(input.model);
  }

  let progressEvents: OcrProgressEvent[] = [];
  progressEvents = appendProgressEvent(
    progressEvents,
    "analyzing",
    input.resumed
      ? `Resuming from page ${startIndex + 1}/${input.inputPreviews.length}`
      : `Document analyzed: ${input.inputPreviews.length} page(s) ready`
  );

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
    checkpoints: [],
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
      checkpoints: pageOutputs.map((page) => ({
        pageNumber: page.pageNumber,
        status: "completed",
        characterCount: page.text.length,
        durationMs: page.durationMs,
        previewText: page.text.trim().slice(0, 320),
      })),
      postProcessing: postProcessingMeta,
    });

    for (const ollamaModel of usedOllamaModels) {
      await unloadOllamaModel(input.settings.apiEndpoint, ollamaModel);
    }

    await db.ocrJob.update({
      where: { id: input.jobId },
      data: {
        status: OcrJobStatus.QUEUED,
        metadata: toJsonValue(latestMetadata),
        processingMs: Date.now() - input.startedAtMs,
      },
    });
    clearOcrJobRunning(input.jobId);
    clearOcrJobStop(input.jobId);
  };

  try {
    clearOcrJobStop(input.jobId);
    markOcrJobRunning(input.jobId);
    if (input.provider === "ollama") {
      await warmupOllamaModel(input.settings.apiEndpoint, input.model);
    }

    await db.ocrJob.update({
      where: { id: input.jobId },
      data: {
        metadata: toJsonValue(latestMetadata),
      },
    });

    for (let index = startIndex; index < input.inputPreviews.length; index++) {
      if (isOcrJobStopRequested(input.jobId)) {
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

      latestMetadata = buildProgressMetadata({
        stage: "ocr",
        message: `Processing page ${pageNumber}/${input.inputPreviews.length}`,
        progressPct:
          input.postProcessingPayload.enabled
            ? (index / input.inputPreviews.length) * 85
            : (index / input.inputPreviews.length) * 100,
        pageCount: input.inputPreviews.length,
        processedPages: index,
        currentPage: pageNumber,
        etaSeconds: latestMetadata.etaSeconds,
        startedAt: startedAtIso,
        events: progressEvents,
        checkpoints: pageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          status: "completed",
          characterCount: page.text.length,
          durationMs: page.durationMs,
          previewText: page.text.trim().slice(0, 320),
        })),
        postProcessing: postProcessingMeta,
      });

      await db.ocrJob.update({
        where: { id: input.jobId },
        data: {
          metadata: toJsonValue(latestMetadata),
        },
      });

      let pageText = "";
      let pageStructured: Record<string, unknown> = { markdown: "" };
      let pageMetadata: Record<string, unknown> = {};
      const pageAbortController = new AbortController();
      registerOcrJobAbortController(input.jobId, pageAbortController);
      try {
        if (input.provider === "ollama") {
          ({ text: pageText, structured: pageStructured, metadata: pageMetadata } = await runOllamaOcr(
            input.settings.apiEndpoint,
            input.model,
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
            input.model,
            pagePreview,
            input.settings.apiKey || process.env.MISTRAL_API_KEY || "",
            mistralEndpoint,
            pageAbortController.signal
          ));
        }
      } catch (error) {
        if (error instanceof OcrStopRequestedError || isOcrJobStopRequested(input.jobId)) {
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
      pageOutputs.push({
        pageNumber,
        text: pageText,
        structured: pageStructured,
        metadata: pageMetadata,
        durationMs,
      });

      const extractedTextSoFar = pageOutputs
        .map((page) => page.text.trim())
        .filter(Boolean)
        .join(pageOutputs.length > 1 ? "\n\n---\n\n" : "\n");

      const averagePageMs =
        pageOutputs.reduce((sum, page) => sum + page.durationMs, 0) / pageOutputs.length;
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
        checkpoints: pageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          status: "completed",
          characterCount: page.text.length,
          durationMs: page.durationMs,
          previewText: page.text.trim().slice(0, 320),
        })),
        postProcessing: postProcessingMeta,
      });

      const partialResult = buildJsonResult(
        input.fileName,
        input.model,
        input.provider,
        input.settingsPayload,
        extractedTextSoFar,
        {
          markdown: extractedTextSoFar,
          pages: pageOutputs.map((page) => ({
            pageNumber: page.pageNumber,
            durationMs: page.durationMs,
            ...page.structured,
          })),
        },
        {
          pageCount: input.inputPreviews.length,
          pageResults: pageOutputs.map((page) => ({
            pageNumber: page.pageNumber,
            durationMs: page.durationMs,
            structured: page.structured,
            ...page.metadata,
          })),
          checkpointPages: pageOutputs.map((page) => ({
            pageNumber: page.pageNumber,
            text: page.text,
            structured: page.structured,
            durationMs: page.durationMs,
            metadata: page.metadata,
          })),
          progress: latestMetadata,
        }
      );
      partialResult.rawExtractionText = extractedTextSoFar;

      await db.ocrJob.update({
        where: { id: input.jobId },
        data: {
          extractedText: extractedTextSoFar,
          result: toJsonValue(partialResult),
          metadata: toJsonValue(latestMetadata),
        },
      });
    }

    const extractedMarkdown = pageOutputs
      .map((page) => page.text.trim())
      .filter(Boolean)
      .join(pageOutputs.length > 1 ? "\n\n---\n\n" : "\n");
    if (!extractedMarkdown.trim()) {
      throw new ApiRouteError("OCR returned no text", 502);
    }

    const pageScopedText = formatPageScopedText(pageOutputs);
    const extractedMetadata: Record<string, unknown> = {
      mode: input.mode,
      pageCount: input.inputPreviews.length,
      pageResults: pageOutputs.map((page) => ({
        pageNumber: page.pageNumber,
        durationMs: page.durationMs,
        structured: page.structured,
        ...page.metadata,
      })),
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
        checkpoints: pageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          status: "completed",
          characterCount: page.text.length,
          durationMs: page.durationMs,
          previewText: page.text.trim().slice(0, 320),
        })),
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
        const postProcessResult = postProcessingProvider === "ollama"
          ? await runOllamaPostProcessing(
              input.settings.apiEndpoint,
              postProcessingModel,
              systemPrompt,
              postProcessRequestText
            )
          : await runMistralPostProcessing(
              postProcessingModel,
              input.settings.apiKey || process.env.MISTRAL_API_KEY || "",
              input.settings.provider === "mistral"
                ? input.settings.apiEndpoint
                : DEFAULT_MISTRAL_API_URL,
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
        checkpoints: pageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          status: "completed",
          characterCount: page.text.length,
          durationMs: page.durationMs,
          previewText: page.text.trim().slice(0, 320),
        })),
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
        input.obsidianPayload.vaultNamePrefix
      );
      if (plan.markdown.trim()) {
        finalMarkdown = plan.markdown.trim();
      }

      const exportOutput = await writeObsidianVault({
        plan,
        fileName: input.fileName,
        requestedRoot: input.obsidianPayload.vaultRoot,
        includePageNotes: input.obsidianPayload.includePageNotes,
        pageOutputs: pageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          text: page.text,
        })),
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
        pages: pageOutputs.map((page) => ({
          pageNumber: page.pageNumber,
          durationMs: page.durationMs,
          ...page.structured,
        })),
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
      checkpoints: pageOutputs.map((page) => ({
        pageNumber: page.pageNumber,
        status: "completed",
        characterCount: page.text.length,
        durationMs: page.durationMs,
        previewText: page.text.trim().slice(0, 320),
      })),
      postProcessing: postProcessingMeta,
    });
    extractedMetadata.progress = latestMetadata;

    await db.ocrJob.update({
      where: { id: input.jobId },
      data: {
        status: OcrJobStatus.COMPLETED,
        extractedText: finalMarkdown,
        result: toJsonValue(result),
        metadata: toJsonValue(extractedMetadata),
        completedAt: new Date(),
        processingMs: Date.now() - input.startedAtMs,
      },
    });
    for (const ollamaModel of usedOllamaModels) {
      await unloadOllamaModel(input.settings.apiEndpoint, ollamaModel);
    }
    clearOcrJobRunning(input.jobId);
    clearOcrJobStop(input.jobId);
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
      checkpoints: pageOutputs.map((page) => ({
        pageNumber: page.pageNumber,
        status: "completed",
        characterCount: page.text.length,
        durationMs: page.durationMs,
        previewText: page.text.trim().slice(0, 320),
      })),
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
    for (const ollamaModel of usedOllamaModels) {
      await unloadOllamaModel(input.settings.apiEndpoint, ollamaModel);
    }
    clearOcrJobRunning(input.jobId);
    clearOcrJobStop(input.jobId);
  }
}

function parseCheckpointPages(result: unknown): Array<{
  pageNumber: number;
  text: string;
  structured: Record<string, unknown>;
  durationMs: number;
  metadata: Record<string, unknown>;
}> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }

  const rawCheckpointPages = (result as { metadata?: { checkpointPages?: unknown } }).metadata?.checkpointPages;
  if (!Array.isArray(rawCheckpointPages)) {
    return [];
  }

  return rawCheckpointPages
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
    .filter((page): page is {
      pageNumber: number;
      text: string;
      structured: Record<string, unknown>;
      durationMs: number;
      metadata: Record<string, unknown>;
    } => Boolean(page))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function GET(request: NextRequest) {
  try {
    const storedSettings = normalizeApiSettings(await getApiSettings());
    const query = new URL(request.url).searchParams;
    const provider = parseProviderHint(query.get("provider") || undefined);
    const catalog = await getModelCatalog(storedSettings);

    if (provider === "ollama") {
      return NextResponse.json({ success: true, models: catalog.ollama });
    }

    if (provider === "mistral") {
      return NextResponse.json({ success: true, models: catalog.mistral });
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
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      throw new ApiRouteError("Unauthorized", 401);
    }

    const storedSettings = normalizeApiSettings(await getApiSettings());
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
    const settings = normalizeApiSettings({
      provider:
        typeof body.apiSettings?.provider === "string"
          ? body.apiSettings.provider
          : typeof body.provider === "string"
            ? body.provider
            : storedSettings.provider,
      apiEndpoint:
        typeof body.apiSettings?.apiEndpoint === "string"
          ? body.apiSettings.apiEndpoint
          : typeof body.apiEndpoint === "string"
            ? body.apiEndpoint
            : storedSettings.apiEndpoint,
      apiKey:
        typeof body.apiSettings?.apiKey === "string"
          ? body.apiSettings.apiKey
          : typeof body.apiKey === "string"
            ? body.apiKey
            : storedSettings.apiKey,
      obsidianBaseDir:
        typeof body.apiSettings?.obsidianBaseDir === "string"
          ? body.apiSettings.obsidianBaseDir
          : storedSettings.obsidianBaseDir,
    });
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

      const initialPageOutputs = parseCheckpointPages(existingJob.result);
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

      void processOcrJobInBackground({
        jobId: existingJob.id,
        startedAtMs,
        fileName,
        model,
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
      });

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

    const createdJob = await db.ocrJob.create({
      data: {
        userId,
        status: OcrJobStatus.PROCESSING,
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
    void processOcrJobInBackground({
      jobId: createdJob.id,
      startedAtMs,
      fileName,
      model,
      provider,
      mode,
      settings,
      settingsPayload,
      postProcessingPayload,
      obsidianPayload: effectiveObsidianPayload,
      inputPreviews,
      prompt,
    });

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
