"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Upload,
  X,
  FileUp,
  Sparkles,
  Code,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Download,
  Copy,
  Check,
  ScanLine,
  Zap,
  Settings2,
  Languages,
  ImageOff,
  FileArchive,
  Eye,
  Columns,
  LogOut,
  History,
  PauseCircle,
  PlayCircle,
  Clock3,
  ListChecks,
  FolderOpen,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

// Types
interface ProcessingFile {
  id: string;
  name: string;
  size: number;
  type: string;
  status: "pending" | "processing" | "paused" | "completed" | "error";
  progress: number;
  result?: {
    text: string;
    json: Record<string, unknown>;
  };
  error?: string;
  preview?: string;
  pagePreviews?: string[];
  pageCount?: number;
  processedPages?: number;
  etaSeconds?: number | null;
  stage?: string;
  stageMessage?: string;
  jobId?: string;
  checkpoints?: OcrPageCheckpointView[];
  events?: OcrProgressEventView[];
  file?: File;
}

interface OcrPageCheckpointView {
  pageNumber: number;
  previewText?: string;
  characterCount?: number;
  durationMs?: number;
}

interface OcrProgressEventView {
  at?: string;
  stage?: string;
  message?: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface ApiSettings {
  provider: string;
  apiEndpoint: string;
  apiKey: string;
  obsidianBaseDir: string;
}

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
  vaultRoot: string;
  vaultNamePrefix: string;
  instruction: string;
  includePageNotes: boolean;
  model: string;
}

interface HistoryJobSummary {
  id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  fileName: string;
  sourcePreview?: string | null;
  model: string;
  createdAt: string;
  completedAt?: string | null;
  processingMs?: number | null;
  metadata?: unknown;
  errorMessage?: string | null;
}

interface HistoryJobDetail extends HistoryJobSummary {
  extractedText?: string | null;
  result?: unknown;
}

type ProviderKind = "ollama" | "mistral";
type ProviderModelSelections = Partial<Record<ProviderKind, string>>;
type UiLanguage = "it" | "en";

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
const DEFAULT_MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/ocr";
const MODEL_SELECTIONS_STORAGE_KEY = "extracto:model-selections:v1";
const POST_PROCESS_MODEL_SELECTIONS_STORAGE_KEY =
  "extracto:post-process-model-selections:v1";
const UI_LANGUAGE_STORAGE_KEY = "extracto:ui-language:v1";
const OCR_RUN_MODE_STORAGE_KEY = "extracto:ocr-run-mode:v1";
const OBSIDIAN_SETTINGS_STORAGE_KEY = "extracto:obsidian-settings:v1";
const DEFAULT_OBSIDIAN_VAULT_ROOT = "/host-vaults";

function normalizeProvider(provider?: string): "ollama" | "mistral" {
  return provider?.trim().toLowerCase().split(":")[0] === "mistral" ? "mistral" : "ollama";
}

function defaultEndpointForProvider(provider: "ollama" | "mistral"): string {
  return provider === "mistral" ? DEFAULT_MISTRAL_ENDPOINT : DEFAULT_OLLAMA_ENDPOINT;
}

const DEFAULT_API_SETTINGS: ApiSettings = {
  provider: "ollama",
  apiEndpoint: DEFAULT_OLLAMA_ENDPOINT,
  apiKey: "",
  obsidianBaseDir: DEFAULT_OBSIDIAN_VAULT_ROOT,
};

// Fallback list before first model fetch (Ollama only; Mistral is dynamic).
const OLLAMA_FALLBACK_MODELS: Model[] = [
  { id: "llama3.2-vision:latest", name: "Llama 3.2 Vision", provider: "ollama" },
  { id: "llava:latest", name: "LLaVA", provider: "ollama" },
  { id: "minicpm-v:latest", name: "MiniCPM-V", provider: "ollama" },
];

function getFallbackModelsForProvider(provider: "ollama" | "mistral"): Model[] {
  return provider === "ollama" ? OLLAMA_FALLBACK_MODELS : [];
}

// Languages
const LANGUAGES = [
  { code: "auto", nameIt: "Rilevamento automatico", nameEn: "Auto Detect" },
  { code: "en", nameIt: "Inglese", nameEn: "English" },
  { code: "es", nameIt: "Spagnolo", nameEn: "Spanish" },
  { code: "fr", nameIt: "Francese", nameEn: "French" },
  { code: "de", nameIt: "Tedesco", nameEn: "German" },
  { code: "zh", nameIt: "Cinese", nameEn: "Chinese" },
  { code: "ja", nameIt: "Giapponese", nameEn: "Japanese" },
  { code: "ko", nameIt: "Coreano", nameEn: "Korean" },
  { code: "pt", nameIt: "Portoghese", nameEn: "Portuguese" },
  { code: "it", nameIt: "Italiano", nameEn: "Italian" },
];

function readProviderModelSelections(storageKey: string): ProviderModelSelections {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const typed = parsed as Record<string, unknown>;
    return {
      ollama: typeof typed.ollama === "string" ? typed.ollama.trim() : "",
      mistral: typeof typed.mistral === "string" ? typed.mistral.trim() : "",
    };
  } catch {
    return {};
  }
}

function writeProviderModelSelections(
  storageKey: string,
  selections: ProviderModelSelections
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        ollama: selections.ollama || "",
        mistral: selections.mistral || "",
      })
    );
  } catch {
    // ignore storage errors
  }
}

function readObsidianSettings(): ObsidianSettings {
  if (typeof window === "undefined") {
    return {
      vaultRoot: DEFAULT_OBSIDIAN_VAULT_ROOT,
      vaultNamePrefix: "",
      instruction: "",
      includePageNotes: true,
      model: "",
    };
  }

  try {
    const raw = window.localStorage.getItem(OBSIDIAN_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return {
        vaultRoot: DEFAULT_OBSIDIAN_VAULT_ROOT,
        vaultNamePrefix: "",
        instruction: "",
        includePageNotes: true,
        model: "",
      };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        vaultRoot: DEFAULT_OBSIDIAN_VAULT_ROOT,
        vaultNamePrefix: "",
        instruction: "",
        includePageNotes: true,
        model: "",
      };
    }

    const typed = parsed as Record<string, unknown>;
    return {
      vaultRoot:
        typeof typed.vaultRoot === "string" && typed.vaultRoot.trim()
          ? typed.vaultRoot.trim()
          : DEFAULT_OBSIDIAN_VAULT_ROOT,
      vaultNamePrefix: typeof typed.vaultNamePrefix === "string" ? typed.vaultNamePrefix.trim() : "",
      instruction: typeof typed.instruction === "string" ? typed.instruction : "",
      includePageNotes:
        typeof typed.includePageNotes === "boolean" ? typed.includePageNotes : true,
      model: typeof typed.model === "string" ? typed.model.trim() : "",
    };
  } catch {
    return {
      vaultRoot: DEFAULT_OBSIDIAN_VAULT_ROOT,
      vaultNamePrefix: "",
      instruction: "",
      includePageNotes: true,
      model: "",
    };
  }
}

function writeObsidianSettings(settings: ObsidianSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      OBSIDIAN_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        vaultRoot: settings.vaultRoot,
        vaultNamePrefix: settings.vaultNamePrefix,
        instruction: settings.instruction,
        includePageNotes: settings.includePageNotes,
        model: settings.model,
      })
    );
  } catch {
    // ignore storage errors
  }
}

function getObsidianMetadata(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const typed = payload as Record<string, unknown>;
  if (
    typed.structured &&
    typeof typed.structured === "object" &&
    !Array.isArray(typed.structured)
  ) {
    const structured = typed.structured as Record<string, unknown>;
    if (
      structured.obsidian &&
      typeof structured.obsidian === "object" &&
      !Array.isArray(structured.obsidian)
    ) {
      return structured.obsidian as Record<string, unknown>;
    }
  }

  if (
    typed.metadata &&
    typeof typed.metadata === "object" &&
    !Array.isArray(typed.metadata)
  ) {
    const metadata = typed.metadata as Record<string, unknown>;
    if (
      metadata.obsidian &&
      typeof metadata.obsidian === "object" &&
      !Array.isArray(metadata.obsidian)
    ) {
      return metadata.obsidian as Record<string, unknown>;
    }
  }

  return {};
}

// Utility functions
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const formatTimestamp = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const formatEta = (value?: number | null): string => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }
  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

function getMarkdownFromJsonPayload(payload: unknown, fallback = ""): string {
  const fallbackNormalized = normalizeMarkdownCandidate(fallback);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallbackNormalized;
  }

  const typed = payload as Record<string, unknown>;
  if (typeof typed.markdown === "string" && typed.markdown.trim()) {
    return normalizeMarkdownCandidate(typed.markdown);
  }

  if (
    typed.structured &&
    typeof typed.structured === "object" &&
    !Array.isArray(typed.structured) &&
    typeof (typed.structured as Record<string, unknown>).markdown === "string" &&
    ((typed.structured as Record<string, unknown>).markdown as string).trim()
  ) {
    return normalizeMarkdownCandidate((typed.structured as Record<string, unknown>).markdown as string);
  }

  if (typeof typed.text === "string" && typed.text.trim()) {
    return normalizeMarkdownCandidate(typed.text);
  }

  return fallbackNormalized;
}

function getStructuredJsonPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const typed = payload as Record<string, unknown>;
  if (typed.structured && typeof typed.structured === "object" && !Array.isArray(typed.structured)) {
    return typed.structured as Record<string, unknown>;
  }

  return typed;
}

function parseLooseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

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
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue
    }
  }

  const balanced = extractFirstBalancedJsonObject(trimmed);
  if (balanced) {
    try {
      const parsed = JSON.parse(balanced);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
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

function normalizeMarkdownCandidate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parsed = parseLooseJsonObject(trimmed);
  if (parsed) {
    const nested = parsed.markdown ?? parsed.text ?? parsed.content;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }

  const extracted = extractMarkdownFromJsonLikeText(trimmed);
  if (extracted) {
    return extracted;
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

const PDF_RENDER_SCALE = 1.5;
const PDF_MAX_DIMENSION = 1600;
const PDFJS_MODULE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

let pdfJsLibPromise: Promise<Record<string, unknown>> | null = null;

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve((event.target?.result as string) || "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function loadPdfJsLib(): Promise<Record<string, unknown>> {
  if (!pdfJsLibPromise) {
    pdfJsLibPromise = import(
      /* webpackIgnore: true */
      PDFJS_MODULE_URL
    ) as Promise<Record<string, unknown>>;
  }

  const pdfjsLib = await pdfJsLibPromise;
  const globalOptions = (pdfjsLib as { GlobalWorkerOptions?: { workerSrc?: string } }).GlobalWorkerOptions;
  if (globalOptions) {
    globalOptions.workerSrc = PDFJS_WORKER_URL;
  }

  return pdfjsLib;
}

async function renderPdfPagesAsImages(file: File, pageLimit?: number): Promise<string[]> {
  const pdfjsLib = await loadPdfJsLib();
  const getDocument = (pdfjsLib as { getDocument?: (input: { data: ArrayBuffer }) => {
    promise: Promise<{
      numPages: number;
      getPage: (index: number) => Promise<{
        getViewport: (input: { scale: number }) => { width: number; height: number };
        render: (input: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
    }>;
  } }).getDocument;
  if (!getDocument) {
    throw new Error("PDF renderer unavailable");
  }

  const loadingTask = getDocument({ data: await file.arrayBuffer() });
  const pdfDocument = await loadingTask.promise;
  const normalizedLimit =
    typeof pageLimit === "number" && Number.isFinite(pageLimit) && pageLimit > 0
      ? Math.floor(pageLimit)
      : pdfDocument.numPages;
  const totalPages = Math.min(pdfDocument.numPages, normalizedLimit);
  const pageImages: string[] = [];

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const constrainedScale = Math.min(
      PDF_RENDER_SCALE,
      PDF_MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height)
    );
    const scale = Math.max(0.75, constrainedScale);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) {
      continue;
    }

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    pageImages.push(canvas.toDataURL("image/jpeg", 0.9));
  }

  return pageImages;
}

async function getPdfPageCount(file: File): Promise<number> {
  const pdfjsLib = await loadPdfJsLib();
  const getDocument = (pdfjsLib as { getDocument?: (input: { data: ArrayBuffer }) => {
    promise: Promise<{ numPages: number }>;
  } }).getDocument;
  if (!getDocument) {
    throw new Error("PDF renderer unavailable");
  }

  const loadingTask = getDocument({ data: await file.arrayBuffer() });
  const pdfDocument = await loadingTask.promise;
  return pdfDocument.numPages;
}

async function buildInitialPreview(file: File): Promise<{
  preview: string;
  pagePreviews?: string[];
  pageCount?: number;
}> {
  if (file.type.startsWith("image/")) {
    const imagePreview = await readImageAsDataUrl(file);
    return { preview: imagePreview, pagePreviews: imagePreview ? [imagePreview] : [], pageCount: 1 };
  }

  if (!isPdfFile(file)) {
    return { preview: "", pageCount: 1 };
  }

  try {
    const pageCount = await getPdfPageCount(file).catch(() => undefined);
    const previews = await renderPdfPagesAsImages(file, 1);
    const firstPage = previews[0] || "";
    return { preview: firstPage, pagePreviews: previews, pageCount };
  } catch {
    return { preview: "" };
  }
}

// Main Component
export default function EstractoPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [files, setFiles] = React.useState<ProcessingFile[]>([]);
  const [selectedModel, setSelectedModel] = React.useState<string>(OLLAMA_FALLBACK_MODELS[0].id);
  const [models, setModels] = React.useState<Model[]>(OLLAMA_FALLBACK_MODELS);
  const [apiSettings, setApiSettings] = React.useState<ApiSettings>(DEFAULT_API_SETTINGS);
  const [apiSettingsDraft, setApiSettingsDraft] = React.useState<ApiSettings>(DEFAULT_API_SETTINGS);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [uiLanguage, setUiLanguage] = React.useState<UiLanguage>("it");
  const [runMode, setRunMode] = React.useState<OcrRunMode>("ocr");
  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<"md" | "json" | null>(null);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = React.useState(true);
  const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"preview" | "split" | "result">("split");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const modelSelectionsRef = React.useRef<ProviderModelSelections>({});
  const postProcessModelSelectionsRef = React.useRef<ProviderModelSelections>({});
  const modelSelectionsHydratedRef = React.useRef(false);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [isSavingApiSettings, setIsSavingApiSettings] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [modelError, setModelError] = React.useState("");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyJobs, setHistoryJobs] = React.useState<HistoryJobSummary[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = React.useState<string | null>(null);
  const [selectedHistoryJob, setSelectedHistoryJob] = React.useState<HistoryJobDetail | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);
  const [isLoadingHistoryDetail, setIsLoadingHistoryDetail] = React.useState(false);
  const [isDeletingHistory, setIsDeletingHistory] = React.useState(false);

  // Advanced settings state
  const [settings, setSettings] = React.useState<AdvancedSettings>({
    language: "auto",
    tableDetection: true,
    handwritingRecognition: false,
    preserveFormatting: true,
    customPrompt: "",
    quality: 80,
  });
  const [postProcessing, setPostProcessing] = React.useState<PostProcessingSettings>({
    enabled: false,
    instruction: "",
    outputFormat: "markdown",
    model: "",
  });
  const [obsidianSettings, setObsidianSettings] = React.useState<ObsidianSettings>({
    vaultRoot: DEFAULT_OBSIDIAN_VAULT_ROOT,
    vaultNamePrefix: "",
    instruction: "",
    includePageNotes: true,
    model: "",
  });

  const selectedFile = files.find((f) => f.id === selectedFileId);
  const selectedFileMarkdown = selectedFile?.result
    ? getMarkdownFromJsonPayload(selectedFile.result.json, selectedFile.result.text)
    : "";
  const selectedFileStructuredJson = selectedFile?.result
    ? getStructuredJsonPayload(selectedFile.result.json)
    : {};
  const selectedFileObsidian = selectedFile?.result
    ? getObsidianMetadata(selectedFile.result.json)
    : {};
  const selectedFileObsidianPath =
    typeof selectedFileObsidian.vaultPath === "string" ? selectedFileObsidian.vaultPath : "";
  const selectedHistoryMarkdown = selectedHistoryJob
    ? getMarkdownFromJsonPayload(selectedHistoryJob.result, selectedHistoryJob.extractedText || "")
    : "";
  const selectedHistoryStructuredJson = selectedHistoryJob
    ? getStructuredJsonPayload(selectedHistoryJob.result)
    : {};
  const selectedHistoryObsidian = selectedHistoryJob
    ? getObsidianMetadata(selectedHistoryJob.result)
    : {};
  const selectedHistoryObsidianPath =
    typeof selectedHistoryObsidian.vaultPath === "string"
      ? selectedHistoryObsidian.vaultPath
      : "";
  const completedCount = files.filter((f) => f.status === "completed").length;
  const canExportZip = Boolean(completedCount > 0 || selectedFile?.status === "completed");
  const errorCount = files.filter((f) => f.status === "error").length;
  const pendingCount = files.filter((f) => f.status === "pending").length;
  const activeProcessingFile = files.find((f) => f.status === "processing") || null;
  const resumableSelectedFile = selectedFile?.status === "paused" ? selectedFile : null;
  const isPostProcessingReady =
    !postProcessing.enabled || postProcessing.instruction.trim().length > 0;
  const isObsidianReady = runMode !== "pdf_to_obsidian" || obsidianSettings.vaultRoot.trim().length > 0;
  const isRunReady = runMode === "pdf_to_obsidian" ? isObsidianReady : isPostProcessingReady;
  const postProcessModelValue = postProcessing.model || "__same__";
  const obsidianModelValue = obsidianSettings.model || "__same__";
  const selectedPostProcessModelExists = postProcessing.model
    ? models.some((model) => model.id === postProcessing.model)
    : true;
  const selectedObsidianModelExists = obsidianSettings.model
    ? models.some((model) => model.id === obsidianSettings.model)
    : true;
  const t = React.useCallback(
    (it: string, en: string) => (uiLanguage === "it" ? it : en),
    [uiLanguage]
  );

  const persistProviderSelection = React.useCallback(
    (storageKey: string, provider: ProviderKind, value: string) => {
      const normalizedValue = value.trim();
      if (storageKey === MODEL_SELECTIONS_STORAGE_KEY) {
        modelSelectionsRef.current = {
          ...modelSelectionsRef.current,
          [provider]: normalizedValue,
        };
        writeProviderModelSelections(storageKey, modelSelectionsRef.current);
        return;
      }

      postProcessModelSelectionsRef.current = {
        ...postProcessModelSelectionsRef.current,
        [provider]: normalizedValue,
      };
      writeProviderModelSelections(storageKey, postProcessModelSelectionsRef.current);
    },
    []
  );

  const fetchAvailableModels = React.useCallback(
    async (values: ApiSettings) => {
      setIsLoadingModels(true);
      setModelError("");

      const normalizedSettings = {
        ...values,
        provider: normalizeProvider(values.provider),
        apiEndpoint: "",
        apiKey: values.apiKey.trim(),
      };
      normalizedSettings.apiEndpoint =
        values.apiEndpoint.trim() || defaultEndpointForProvider(normalizedSettings.provider);

      try {
        const params = new URLSearchParams();
        params.set("host", normalizedSettings.apiEndpoint);
        params.set("provider", normalizedSettings.provider || DEFAULT_API_SETTINGS.provider);
        const response = await fetch(`/api/models?${params.toString()}`, {
          headers: normalizedSettings.apiKey
            ? {
                "x-api-key": normalizedSettings.apiKey,
              }
            : undefined,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `Failed to load models (${response.status})`);
        }

        const payload = (await response.json()) as { models?: Model[] };
        const discoveredModels = Array.isArray(payload.models) ? payload.models : [];
        const fallbackModels = getFallbackModelsForProvider(
          normalizedSettings.provider as ProviderKind
        );
        const nextModels = discoveredModels.length > 0 ? discoveredModels : fallbackModels;
        const providerModelIds = nextModels
          .filter((model) => normalizeProvider(model.provider) === normalizedSettings.provider)
          .map((model) => model.id);
        const storedModel =
          modelSelectionsRef.current[normalizedSettings.provider as ProviderKind]?.trim() || "";
        const providerFirstModelId = providerModelIds[0] || nextModels[0]?.id || "";

        setModels(nextModels);
        setSelectedModel((current) => {
          const currentInProvider = providerModelIds.includes(current);
          const storedInProvider = storedModel && providerModelIds.includes(storedModel);
          const nextValue = storedInProvider
            ? storedModel
            : currentInProvider
              ? current
              : providerFirstModelId;
          if (nextValue) {
            persistProviderSelection(
              MODEL_SELECTIONS_STORAGE_KEY,
              normalizedSettings.provider as ProviderKind,
              nextValue
            );
          }
          return nextValue;
        });
        return nextModels;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to fetch models";
        setModelError(message);
        const fallbackModels = getFallbackModelsForProvider(
          normalizedSettings.provider as ProviderKind
        );
        setModels(fallbackModels);
        const providerModelIds = fallbackModels
          .filter((model) => normalizeProvider(model.provider) === normalizedSettings.provider)
          .map((model) => model.id);
        const storedModel =
          modelSelectionsRef.current[normalizedSettings.provider as ProviderKind]?.trim() || "";
        const providerFirstModelId = providerModelIds[0] || fallbackModels[0]?.id || "";
        setSelectedModel((current) => {
          const currentInProvider = providerModelIds.includes(current);
          const storedInProvider = storedModel && providerModelIds.includes(storedModel);
          const nextValue = storedInProvider
            ? storedModel
            : currentInProvider
              ? current
              : providerFirstModelId;
          if (nextValue) {
            persistProviderSelection(
              MODEL_SELECTIONS_STORAGE_KEY,
              normalizedSettings.provider as ProviderKind,
              nextValue
            );
          }
          return nextValue;
        });
        toast({
          title: t("Recupero modelli non riuscito", "Model fetch failed"),
          description: message,
          variant: "destructive",
        });
        return fallbackModels;
      } finally {
        setIsLoadingModels(false);
      }
    },
    [persistProviderSelection, toast]
  );

  const loadSavedSettings = React.useCallback(async () => {
    try {
      const response = await fetch("/api/settings", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to load API settings (${response.status})`);
      }

      const values = (await response.json()) as ApiSettings;
      const provider = normalizeProvider(values.provider);
      const normalizedSettings: ApiSettings = {
        provider,
        apiEndpoint: values.apiEndpoint?.trim() || defaultEndpointForProvider(provider),
        apiKey: values.apiKey?.trim() || "",
        obsidianBaseDir: values.obsidianBaseDir?.trim() || DEFAULT_OBSIDIAN_VAULT_ROOT,
      };
      setApiSettings(normalizedSettings);
      setApiSettingsDraft(normalizedSettings);
      setObsidianSettings((prev) => ({
        ...prev,
        vaultRoot: normalizedSettings.obsidianBaseDir,
      }));
      await fetchAvailableModels(normalizedSettings);
    } catch (error) {
      setApiSettings(DEFAULT_API_SETTINGS);
      setApiSettingsDraft(DEFAULT_API_SETTINGS);
      setObsidianSettings((prev) => ({
        ...prev,
        vaultRoot: DEFAULT_API_SETTINGS.obsidianBaseDir,
      }));
      await fetchAvailableModels(DEFAULT_API_SETTINGS);
      toast({
        title: t("Caricamento impostazioni non riuscito", "Settings load failed"),
        description:
          error instanceof Error
            ? error.message
            : t("Impossibile caricare le impostazioni API, uso i valori predefiniti", "Unable to load API settings, using defaults"),
        variant: "destructive",
      });
    }
  }, [fetchAvailableModels, toast]);

  const saveApiSettings = async () => {
    setIsSavingApiSettings(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiSettingsDraft),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Failed to save API settings (${response.status})`);
      }

      const saved = (await response.json()) as ApiSettings;
      const provider = normalizeProvider(saved.provider);
      const normalizedSettings: ApiSettings = {
        provider,
        apiEndpoint: saved.apiEndpoint?.trim() || defaultEndpointForProvider(provider),
        apiKey: saved.apiKey?.trim() || "",
        obsidianBaseDir: saved.obsidianBaseDir?.trim() || DEFAULT_OBSIDIAN_VAULT_ROOT,
      };

      setApiSettings(normalizedSettings);
      setObsidianSettings((prev) => ({
        ...prev,
        vaultRoot: normalizedSettings.obsidianBaseDir,
      }));
      setApiSettingsOpen(false);
      await fetchAvailableModels(normalizedSettings);
      toast({
        title: t("Impostazioni salvate", "Settings saved"),
        description: t("Configurazione API aggiornata", "API configuration has been updated"),
      });
    } catch (error) {
      toast({
        title: t("Salvataggio non riuscito", "Save failed"),
        description: error instanceof Error ? error.message : t("Impossibile salvare le impostazioni API", "Unable to save API settings"),
        variant: "destructive",
      });
    } finally {
      setIsSavingApiSettings(false);
    }
  };

  const loadHistoryJobs = React.useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const response = await fetch("/api/jobs?limit=100", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Failed to load history (${response.status})`);
      }

      const payload = (await response.json()) as { jobs?: HistoryJobSummary[] };
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      setHistoryJobs(jobs);
      if (jobs.length > 0) {
        setSelectedHistoryId((current) => current && jobs.some((job) => job.id === current) ? current : jobs[0].id);
      } else {
        setSelectedHistoryId(null);
        setSelectedHistoryJob(null);
      }
    } catch (error) {
      toast({
        title: t("Caricamento cronologia non riuscito", "History load failed"),
        description: error instanceof Error ? error.message : t("Impossibile caricare la cronologia OCR", "Unable to load OCR history"),
        variant: "destructive",
      });
    } finally {
      setIsLoadingHistory(false);
    }
  }, [toast]);

  const loadHistoryDetail = React.useCallback(async (jobId: string) => {
    setIsLoadingHistoryDetail(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Failed to load run (${response.status})`);
      }
      const payload = (await response.json()) as { job?: HistoryJobDetail };
      if (!payload.job) {
        throw new Error("Run not found");
      }
      setSelectedHistoryJob(payload.job);
    } catch (error) {
      setSelectedHistoryJob(null);
      toast({
        title: t("Caricamento esecuzione non riuscito", "Run load failed"),
        description: error instanceof Error ? error.message : t("Impossibile caricare l'esecuzione OCR", "Unable to load OCR run"),
        variant: "destructive",
      });
    } finally {
      setIsLoadingHistoryDetail(false);
    }
  }, [toast]);

  const openHistoryModal = async () => {
    setHistoryOpen(true);
    await loadHistoryJobs();
  };

  const deleteHistoryJob = async () => {
    if (!selectedHistoryId) return;
    setIsDeletingHistory(true);
    try {
      const response = await fetch(`/api/jobs/${selectedHistoryId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Delete failed (${response.status})`);
      }

      setSelectedHistoryJob(null);
      await loadHistoryJobs();

      toast({
        title: t("Esecuzione eliminata", "Run deleted"),
        description: t("Esecuzione OCR rimossa dalla cronologia", "Past OCR run removed from history"),
      });
    } catch (error) {
      toast({
        title: t("Eliminazione non riuscita", "Delete failed"),
        description: error instanceof Error ? error.message : t("Impossibile eliminare l'esecuzione OCR", "Unable to delete OCR run"),
        variant: "destructive",
      });
    } finally {
      setIsDeletingHistory(false);
    }
  };

  const downloadHistoryResult = (type: "md" | "json") => {
    if (!selectedHistoryJob) return;
    const fileStem = selectedHistoryJob.fileName.replace(/\.[^/.]+$/, "") || "ocr-result";

    if (type === "md") {
      const markdown = selectedHistoryMarkdown;
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileStem}.md`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const jsonValue = selectedHistoryStructuredJson;
    const blob = new Blob([JSON.stringify(jsonValue, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileStem}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  React.useEffect(() => {
    try {
      const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
      if (storedLanguage === "it" || storedLanguage === "en") {
        setUiLanguage(storedLanguage);
      }

      const storedRunMode = window.localStorage.getItem(OCR_RUN_MODE_STORAGE_KEY);
      if (storedRunMode === "ocr" || storedRunMode === "pdf_to_obsidian") {
        setRunMode(storedRunMode);
      }
    } catch {
      // ignore storage errors
    }

    setObsidianSettings(readObsidianSettings());
    modelSelectionsRef.current = readProviderModelSelections(MODEL_SELECTIONS_STORAGE_KEY);
    postProcessModelSelectionsRef.current = readProviderModelSelections(
      POST_PROCESS_MODEL_SELECTIONS_STORAGE_KEY
    );
    modelSelectionsHydratedRef.current = true;
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, uiLanguage);
    } catch {
      // ignore storage errors
    }
  }, [uiLanguage]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(OCR_RUN_MODE_STORAGE_KEY, runMode);
    } catch {
      // ignore storage errors
    }
  }, [runMode]);

  React.useEffect(() => {
    writeObsidianSettings(obsidianSettings);
  }, [obsidianSettings]);

  React.useEffect(() => {
    void loadSavedSettings();
  }, [loadSavedSettings]);

  React.useEffect(() => {
    if (!modelSelectionsHydratedRef.current || !selectedModel) {
      return;
    }

    const provider = normalizeProvider(apiSettings.provider);
    const selectedModelData = models.find((model) => model.id === selectedModel);
    if (selectedModelData && normalizeProvider(selectedModelData.provider) !== provider) {
      return;
    }

    persistProviderSelection(MODEL_SELECTIONS_STORAGE_KEY, provider, selectedModel);
  }, [apiSettings.provider, models, persistProviderSelection, selectedModel]);

  React.useEffect(() => {
    if (!modelSelectionsHydratedRef.current) {
      return;
    }

    const provider = normalizeProvider(apiSettings.provider);
    const storedModel =
      postProcessModelSelectionsRef.current[provider as ProviderKind]?.trim() || "";
    const providerModelIds = models
      .filter((model) => normalizeProvider(model.provider) === provider)
      .map((model) => model.id);
    const nextModel = storedModel && providerModelIds.includes(storedModel) ? storedModel : "";
    setPostProcessing((prev) => (prev.model === nextModel ? prev : { ...prev, model: nextModel }));
  }, [apiSettings.provider, models]);

  React.useEffect(() => {
    if (!modelSelectionsHydratedRef.current) {
      return;
    }

    const provider = normalizeProvider(apiSettings.provider);
    if (!postProcessing.model) {
      persistProviderSelection(POST_PROCESS_MODEL_SELECTIONS_STORAGE_KEY, provider, "");
      return;
    }

    const selectedModelData = models.find((model) => model.id === postProcessing.model);
    if (selectedModelData && normalizeProvider(selectedModelData.provider) !== provider) {
      return;
    }

    persistProviderSelection(
      POST_PROCESS_MODEL_SELECTIONS_STORAGE_KEY,
      provider,
      postProcessing.model
    );
  }, [apiSettings.provider, models, persistProviderSelection, postProcessing.model]);

  React.useEffect(() => {
    if (!historyOpen) {
      return;
    }

    if (!selectedHistoryId) {
      setSelectedHistoryJob(null);
      return;
    }

    void loadHistoryDetail(selectedHistoryId);
  }, [historyOpen, selectedHistoryId, loadHistoryDetail]);

  // Handle file selection
  const handleFiles = async (fileList: FileList | File[]) => {
    const newFiles: ProcessingFile[] = [];

    for (const file of Array.from(fileList)) {
      const previewData = await buildInitialPreview(file);
      newFiles.push({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "pending",
        progress: 0,
        preview: previewData.preview,
        pagePreviews: previewData.pagePreviews,
        pageCount: previewData.pageCount,
        processedPages: 0,
        etaSeconds: null,
        stage: "pending",
        stageMessage: "Ready",
        checkpoints: [],
        events: [],
        file,
      });
    }

    setFiles((prev) => [...prev, ...newFiles]);
    if (newFiles.length > 0 && !selectedFileId) {
      setSelectedFileId(newFiles[0].id);
    }

    toast({
      title: t("File aggiunti", "Files added"),
      description: t(`${newFiles.length} file pronti per l'OCR`, `${newFiles.length} file(s) ready for OCR processing`),
    });
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // Remove file
  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (selectedFileId === id) {
      const remaining = files.filter((f) => f.id !== id);
      setSelectedFileId(remaining[0]?.id || null);
    }
  };

  // Clear all files
  const clearAllFiles = () => {
    setFiles([]);
    setSelectedFileId(null);
  };

  // Copy to clipboard
  const copyToClipboard = async (type: "md" | "json") => {
    if (!selectedFile?.result) return;

    const text = type === "md"
      ? selectedFileMarkdown
      : JSON.stringify(selectedFileStructuredJson, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);

    toast({
      title: t("Copiato negli appunti", "Copied to clipboard!"),
      description: t(`Contenuto ${type === "md" ? "Markdown" : "JSON"} copiato`, `${type === "md" ? "Markdown" : "JSON"} content has been copied`),
    });
  };

  // Download result
  const downloadResult = (type: "md" | "json") => {
    if (!selectedFile?.result) return;

    const text = type === "md"
      ? selectedFileMarkdown
      : JSON.stringify(selectedFileStructuredJson, null, 2);
    const blob = new Blob([text], { type: type === "md" ? "text/markdown" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedFile.name.replace(/\.[^/.]+$/, "")}.${type === "md" ? "md" : "json"}`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: t("Download avviato", "Download started"),
      description: t(`${selectedFile.name}.${type === "md" ? "md" : "json"} in download`, `${selectedFile.name}.${type === "md" ? "md" : "json"} is being downloaded`),
    });
  };

  // Export all as zip
  const exportAllAsZip = async () => {
    const completedFiles = files.filter((f) => f.status === "completed" && f.result);
    if (completedFiles.length === 0) {
      toast({
        title: t("Nessun file da esportare", "No files to export"),
        description: t("Elabora prima alcuni file, poi esporta", "Process some files first before exporting"),
        variant: "destructive",
      });
      return;
    }

    // Dynamic import of JSZip
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    // Create folders
    const mdFolder = zip.folder("markdown");
    const jsonFolder = zip.folder("json");

    completedFiles.forEach((file) => {
      if (file.result) {
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        mdFolder?.file(`${baseName}.md`, getMarkdownFromJsonPayload(file.result.json, file.result.text));
        jsonFolder?.file(`${baseName}.json`, JSON.stringify(getStructuredJsonPayload(file.result.json), null, 2));
      }
    });

    // Generate and download zip
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estraction-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: t("Esportazione completata", "Export complete!"),
      description: t(`${completedFiles.length} file esportati in ZIP`, `${completedFiles.length} files exported to ZIP archive`),
    });
  };

  const ensurePagePreviews = async (file: ProcessingFile): Promise<string[]> => {
    if (file.file && isPdfFile(file.file)) {
      const cachedPages = Array.isArray(file.pagePreviews) ? file.pagePreviews.filter(Boolean) : [];
      if (cachedPages.length > 1) {
        return cachedPages;
      }

      const renderedPages = await renderPdfPagesAsImages(file.file);
      if (renderedPages.length === 0) {
        throw new Error("Unable to render PDF pages for OCR");
      }

      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === file.id
            ? {
                ...entry,
                preview: renderedPages[0],
                pagePreviews: renderedPages,
                pageCount: renderedPages.length,
              }
            : entry
        )
      );

      return renderedPages;
    }

    if (file.preview?.trim()) {
      return [file.preview.trim()];
    }

    return [];
  };

  const parseProgressMetadata = (metadata: unknown) => {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return null;
    }
    const value = metadata as Record<string, unknown>;
    const checkpoints = Array.isArray(value.checkpoints)
      ? value.checkpoints
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return null;
            const typed = item as Record<string, unknown>;
            if (typeof typed.pageNumber !== "number") return null;
            return {
              pageNumber: typed.pageNumber,
              previewText: typeof typed.previewText === "string" ? typed.previewText : undefined,
              characterCount:
                typeof typed.characterCount === "number" ? typed.characterCount : undefined,
              durationMs: typeof typed.durationMs === "number" ? typed.durationMs : undefined,
            } as OcrPageCheckpointView;
          })
          .filter(Boolean) as OcrPageCheckpointView[]
      : [];
    const events = Array.isArray(value.events)
      ? value.events
          .map((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return null;
            const typed = item as Record<string, unknown>;
            return {
              at: typeof typed.at === "string" ? typed.at : undefined,
              stage: typeof typed.stage === "string" ? typed.stage : undefined,
              message: typeof typed.message === "string" ? typed.message : undefined,
            } as OcrProgressEventView;
          })
          .filter(Boolean) as OcrProgressEventView[]
      : [];

    return {
      stage: typeof value.stage === "string" ? value.stage : undefined,
      message: typeof value.message === "string" ? value.message : undefined,
      progressPct: typeof value.progressPct === "number" ? value.progressPct : undefined,
      pageCount: typeof value.pageCount === "number" ? value.pageCount : undefined,
      processedPages: typeof value.processedPages === "number" ? value.processedPages : undefined,
      etaSeconds: typeof value.etaSeconds === "number" ? value.etaSeconds : null,
      checkpoints,
      events,
    };
  };

  const pollJobUntilStopped = async (
    fileId: string,
    jobId: string
  ): Promise<{
    status: "completed" | "paused";
    text?: string;
    json?: Record<string, unknown>;
    error?: string;
  }> => {
    while (true) {
      const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Failed to poll OCR job (${response.status})`);
      }

      const payload = (await response.json()) as {
        job?: {
          status?: string;
          extractedText?: string | null;
          result?: unknown;
          metadata?: unknown;
          errorMessage?: string | null;
        };
      };
      const job = payload.job;
      if (!job) {
        throw new Error("OCR job payload missing");
      }

      const progressMeta = parseProgressMetadata(job.metadata);
      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === fileId
            ? (() => {
                const nextStatus: ProcessingFile["status"] =
                  job.status === "COMPLETED"
                    ? "completed"
                    : job.status === "FAILED"
                      ? "error"
                      : job.status === "QUEUED" && progressMeta?.stage === "paused"
                        ? "paused"
                        : "processing";
                return {
                  ...entry,
                  jobId,
                  status: nextStatus,
                  progress:
                    typeof progressMeta?.progressPct === "number"
                      ? Math.max(0, Math.min(100, progressMeta.progressPct))
                      : entry.progress,
                  pageCount: progressMeta?.pageCount ?? entry.pageCount,
                  processedPages: progressMeta?.processedPages ?? entry.processedPages,
                  etaSeconds:
                    progressMeta?.etaSeconds === null || typeof progressMeta?.etaSeconds === "number"
                      ? progressMeta.etaSeconds
                      : entry.etaSeconds,
                  stage: progressMeta?.stage || entry.stage,
                  stageMessage: progressMeta?.message || entry.stageMessage,
                  checkpoints: progressMeta?.checkpoints ?? entry.checkpoints,
                  events: progressMeta?.events ?? entry.events,
                  result:
                    job.result && typeof job.result === "object" && !Array.isArray(job.result)
                      ? {
                          text:
                            typeof job.extractedText === "string"
                              ? job.extractedText
                              : entry.result?.text || "",
                          json: job.result as Record<string, unknown>,
                        }
                      : entry.result,
                  error:
                    job.status === "FAILED"
                      ? job.errorMessage || t("Elaborazione non riuscita", "Processing failed")
                      : entry.error,
                };
              })()
            : entry
        )
      );

      if (job.status === "COMPLETED") {
        return {
          status: "completed",
          text: typeof job.extractedText === "string" ? job.extractedText : "",
          json:
            job.result && typeof job.result === "object" && !Array.isArray(job.result)
              ? (job.result as Record<string, unknown>)
              : {},
        };
      }
      if (job.status === "FAILED") {
        throw new Error(job.errorMessage || t("Elaborazione non riuscita", "Processing failed"));
      }
      if (job.status === "QUEUED" && progressMeta?.stage === "paused") {
        return { status: "paused" };
      }

      await sleep(1000);
    }
  };

  const startOrResumeOcr = async (
    file: ProcessingFile,
    pagePreviews: string[],
    resume = false
  ): Promise<{ jobId: string }> => {
    const response = await fetch("/api/ocr", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId: file.jobId,
        resume,
        fileName: file.name,
        model: selectedModel,
        mode: runMode,
        preview: pagePreviews[0],
        pages: pagePreviews,
        settings,
        postProcessing,
        obsidian: {
          enabled: runMode === "pdf_to_obsidian",
          vaultRoot: obsidianSettings.vaultRoot,
          vaultNamePrefix: obsidianSettings.vaultNamePrefix,
          instruction: obsidianSettings.instruction,
          includePageNotes: obsidianSettings.includePageNotes,
          model: obsidianSettings.model,
        },
        apiSettings,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; success?: boolean }
        | null;
      throw new Error(payload?.error || `OCR processing failed (${response.status})`);
    }

    const payload = (await response.json()) as { jobId?: string };
    if (!payload.jobId) {
      throw new Error("OCR job id missing");
    }

    return { jobId: payload.jobId };
  };

  const processSingleFile = async (file: ProcessingFile, resume = false) => {
    const pagePreviews = await ensurePagePreviews(file);
    if (pagePreviews.length === 0) {
      throw new Error("No image preview available for OCR");
    }

    setFiles((prev) =>
      prev.map((entry) =>
        entry.id === file.id
          ? {
              ...entry,
              status: "processing",
              progress: Math.max(entry.progress, 1),
              stage: resume ? "resuming" : "queued",
              stageMessage: resume
                ? t("Ripresa dal checkpoint...", "Resuming from checkpoint...")
                : runMode === "pdf_to_obsidian"
                  ? t(
                      `In coda per PDF→Obsidian (${pagePreviews.length} pagine)`,
                      `Queued for PDF→Obsidian (${pagePreviews.length} pages)`
                    )
                  : t(`In coda per OCR (${pagePreviews.length} pagine)`, `Queued for OCR (${pagePreviews.length} pages)`),
              pageCount: pagePreviews.length,
              processedPages: entry.processedPages || 0,
              etaSeconds: null,
              error: undefined,
            }
          : entry
      )
    );

    const startPayload = await startOrResumeOcr(file, pagePreviews, resume);
    setFiles((prev) =>
      prev.map((entry) =>
        entry.id === file.id
          ? {
              ...entry,
              jobId: startPayload.jobId,
            }
          : entry
      )
    );

    return pollJobUntilStopped(file.id, startPayload.jobId);
  };

  // Process files with OCR
  const processFiles = async () => {
    if (files.length === 0) return;
    if (!selectedModel.trim()) {
      toast({
        title: t("Modello mancante", "Missing model"),
        description: t(
          "Seleziona prima un modello disponibile per il provider scelto.",
          "Select an available model for the selected provider first."
        ),
        variant: "destructive",
      });
      return;
    }
    if (!isRunReady) {
      if (runMode === "pdf_to_obsidian") {
        toast({
          title: t("Percorso vault mancante", "Missing vault root path"),
          description: t("Imposta il percorso root dove creare i vault Obsidian.", "Set the root path where Obsidian vaults should be created."),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: t("Istruzione post-processing mancante", "Missing post-processing instruction"),
        description: t("Aggiungi un'istruzione o disattiva il post-processing prima di avviare l'OCR.", "Add an instruction or disable post-processing before running OCR."),
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    const filesToProcess = files.filter((f) => f.status === "pending");
    let completedInRun = 0;

    for (const file of filesToProcess) {
      try {
        const result = await processSingleFile(file, false);
        if (result.status === "completed") {
          completedInRun += 1;
          if (runMode === "pdf_to_obsidian" && result.json) {
            const obsidian = getObsidianMetadata(result.json);
            const vaultPath =
              typeof obsidian.vaultPath === "string" ? obsidian.vaultPath : "";
            if (vaultPath) {
              toast({
                title: t("Vault Obsidian creato", "Obsidian vault created"),
                description: vaultPath,
              });
            }
          }
        } else if (result.status === "paused") {
          toast({
            title: t("OCR in pausa", "OCR paused"),
            description: t(`${file.name} messo in pausa al checkpoint. Premi Riprendi per continuare.`, `${file.name} paused at checkpoint. Click Resume to continue.`),
          });
          break;
        }
      } catch (error) {
        setFiles((prev) =>
          prev.map((entry) =>
            entry.id === file.id
              ? {
                  ...entry,
                  status: "error",
                  error: error instanceof Error ? error.message : t("Elaborazione non riuscita", "Processing failed"),
                }
              : entry
          )
        );
      }
    }

    setIsProcessing(false);
    if (completedInRun > 0) {
      toast({
        title: t("Elaborazione completata", "Processing complete"),
        description: t(`${completedInRun} file elaborati con successo`, `${completedInRun} file(s) processed successfully`),
      });
    }
  };

  const stopProcessingFile = async (file: ProcessingFile) => {
    if (!file.jobId || file.status !== "processing") {
      return;
    }
    try {
      const response = await fetch(`/api/jobs/${file.jobId}/control`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "stop",
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `Stop failed (${response.status})`);
      }
      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === file.id
            ? {
                ...entry,
                stageMessage: t("Stop richiesto. Interruzione inferenza corrente...", "Stop requested. Aborting current inference..."),
              }
            : entry
        )
      );
      toast({
        title: t("Stop richiesto", "Stop requested"),
        description: t("Interruzione immediata dell'inferenza e scaricamento del modello.", "Aborting current inference now and unloading the model."),
      });
    } catch (error) {
      toast({
        title: t("Stop non riuscito", "Stop failed"),
        description: error instanceof Error ? error.message : t("Impossibile fermare l'OCR", "Unable to stop OCR"),
        variant: "destructive",
      });
    }
  };

  const resumeProcessingFile = async (file: ProcessingFile) => {
    if (file.status !== "paused") {
      return;
    }
    setIsProcessing(true);
    try {
      const result = await processSingleFile(file, true);
      if (result.status === "completed") {
        toast({
          title: t("Ripresa completata", "Resume complete"),
          description: t(`${file.name} ripreso e completato con successo.`, `${file.name} resumed and finished successfully.`),
        });
      }
    } catch (error) {
      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === file.id
            ? {
                ...entry,
                status: "error",
                error: error instanceof Error ? error.message : t("Ripresa non riuscita", "Resume failed"),
              }
            : entry
        )
      );
      toast({
        title: t("Ripresa non riuscita", "Resume failed"),
        description: error instanceof Error ? error.message : t("Impossibile riprendere l'OCR", "Unable to resume OCR"),
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      const response = await fetch("/api/auth/signout", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Sign out failed (${response.status})`);
      }

      router.replace("/auth");
    } catch (error) {
      toast({
        title: t("Disconnessione non riuscita", "Sign out failed"),
        description: error instanceof Error ? error.message : t("Riprova", "Please try again"),
        variant: "destructive",
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      {/* Header */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm"
      >
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <motion.div
            className="flex items-center gap-3"
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 400 }}
          >
            <div className="relative">
              <ScanLine className="h-7 w-7 text-primary" />
              <motion.div
                className="absolute -top-1 -right-1"
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="h-3 w-3 text-amber-500" />
              </motion.div>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Estracto</h1>
            </div>
          </motion.div>

          <div className="flex items-center gap-3">
            <Select value={uiLanguage} onValueChange={(value) => setUiLanguage(value as UiLanguage)}>
              <SelectTrigger className="w-[90px] h-9" aria-label={t("Lingua", "Language")}>
                <div className="flex items-center gap-1.5">
                  <Languages className="h-3.5 w-3.5 text-primary" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="it">IT</SelectItem>
                <SelectItem value="en">EN</SelectItem>
              </SelectContent>
            </Select>

            {/* Model Selector */}
            <Select
              value={selectedModel}
              onValueChange={setSelectedModel}
              disabled={isLoadingModels || models.length === 0}
            >
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue
                  placeholder={isLoadingModels ? t("Caricamento modelli...", "Loading models...") : t("Seleziona modello", "Select model")}
                />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <motion.div whileHover={{ y: -1, scale: 1.05 }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.16 }}>
              <Button
                variant="outline"
                size="icon"
                className="group"
                onClick={openHistoryModal}
                aria-label={t("OCR passati", "Past OCR")}
                title={t("OCR passati", "Past OCR")}
              >
                <History className="h-4 w-4 text-sky-400 transition-transform duration-200 group-hover:-rotate-6 group-hover:scale-110" />
              </Button>
            </motion.div>

            <motion.div whileHover={{ y: -1, scale: 1.05 }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.16 }}>
              <Button
                variant="outline"
                size="icon"
                className="group"
                onClick={() => {
                  setApiSettingsDraft(apiSettings);
                  setApiSettingsOpen(true);
                }}
                aria-label={t("Impostazioni", "Settings")}
                title={t("Impostazioni", "Settings")}
              >
                <Settings2 className="h-4 w-4 text-amber-400 transition-transform duration-200 group-hover:rotate-12 group-hover:scale-110" />
              </Button>
            </motion.div>

            {modelError ? <p className="text-xs text-destructive max-w-[180px] truncate">{modelError}</p> : null}

            {/* Export All Button */}
            {canExportZip && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <Button variant="outline" size="sm" className="group" onClick={exportAllAsZip}>
                  <FileArchive className="h-4 w-4 mr-1.5 text-violet-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-110" />
                  {t("Esporta ZIP", "Export ZIP")}
                </Button>
              </motion.div>
            )}

            <ThemeToggle />
          </div>
        </div>
      </motion.header>

      <Dialog
        open={apiSettingsOpen}
        onOpenChange={(open) => {
          setApiSettingsOpen(open);
          if (!open) {
            setApiSettingsDraft(apiSettings);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Impostazioni API", "API Endpoint Settings")}</DialogTitle>
            <DialogDescription>
              {t("Configura provider, endpoint e account.", "Configure provider access and account actions.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">{t("Provider", "Provider")}</Label>
              <Select
                value={apiSettingsDraft.provider}
                onValueChange={(value) =>
                  setApiSettingsDraft((prev) => {
                    const nextProvider = normalizeProvider(value);
                    const trimmedEndpoint = prev.apiEndpoint.trim();
                    const shouldResetToMistral =
                      nextProvider === "mistral" &&
                      (!trimmedEndpoint ||
                        trimmedEndpoint === DEFAULT_OLLAMA_ENDPOINT ||
                        trimmedEndpoint === "http://127.0.0.1:11434");
                    const shouldResetToOllama =
                      nextProvider === "ollama" &&
                      (!trimmedEndpoint ||
                        trimmedEndpoint === DEFAULT_MISTRAL_ENDPOINT ||
                        trimmedEndpoint === "https://api.mistral.ai");
                    return {
                      ...prev,
                      provider: nextProvider,
                      apiEndpoint: shouldResetToMistral
                        ? DEFAULT_MISTRAL_ENDPOINT
                        : shouldResetToOllama
                          ? DEFAULT_OLLAMA_ENDPOINT
                          : prev.apiEndpoint,
                    };
                  })
                }
              >
                <SelectTrigger id="provider" className="w-full">
                  <SelectValue placeholder={t("Seleziona provider", "Select provider")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="mistral">Mistral OCR API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-endpoint">{t("Endpoint API", "API endpoint")}</Label>
              <Input
                id="api-endpoint"
                value={apiSettingsDraft.apiEndpoint}
                onChange={(event) =>
                  setApiSettingsDraft((prev) => ({ ...prev, apiEndpoint: event.target.value }))
                }
                placeholder={
                  normalizeProvider(apiSettingsDraft.provider) === "mistral"
                    ? DEFAULT_MISTRAL_ENDPOINT
                    : DEFAULT_OLLAMA_ENDPOINT
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-key">{t("API key (opzionale)", "API key (optional)")}</Label>
              <Input
                id="api-key"
                type="password"
                value={apiSettingsDraft.apiKey}
                onChange={(event) =>
                  setApiSettingsDraft((prev) => ({ ...prev, apiKey: event.target.value }))
                }
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="obsidian-base-dir">
                {t("Directory base Obsidian", "Obsidian base directory")}
              </Label>
              <Input
                id="obsidian-base-dir"
                value={apiSettingsDraft.obsidianBaseDir}
                onChange={(event) =>
                  setApiSettingsDraft((prev) => ({
                    ...prev,
                    obsidianBaseDir: event.target.value,
                  }))
                }
                placeholder={DEFAULT_OBSIDIAN_VAULT_ROOT}
              />
              <p className="text-[11px] text-muted-foreground">
                {t(
                  "Root usata per creare i nuovi vault in modalità PDF → Obsidian.",
                  "Root used to create new vaults in PDF → Obsidian mode."
                )}
              </p>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>{t("Account", "Account")}</Label>
              <Button
                variant="outline"
                className="w-full justify-start group"
                onClick={signOut}
                disabled={isSigningOut}
              >
                {isSigningOut ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4 mr-1.5 text-rose-400 transition-transform duration-200 group-hover:translate-x-0.5" />
                )}
                {t("Esci", "Sign out")}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setApiSettingsOpen(false);
                setApiSettingsDraft(apiSettings);
              }}
              disabled={isSavingApiSettings}
            >
              {t("Annulla", "Cancel")}
            </Button>
            <Button onClick={saveApiSettings} disabled={isSavingApiSettings}>
              {isSavingApiSettings ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              {t("Salva", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={historyOpen}
        onOpenChange={(open) => {
          setHistoryOpen(open);
          if (!open) {
            setSelectedHistoryId(null);
            setSelectedHistoryJob(null);
          }
        }}
      >
        <DialogContent className="w-[96vw] !max-w-[96vw] h-[92vh] flex flex-col overflow-hidden p-4 sm:w-[94vw] sm:!max-w-[94vw] sm:h-[90vh] sm:p-5">
          <DialogHeader>
            <DialogTitle>{t("Esecuzioni OCR passate", "Past OCR Runs")}</DialogTitle>
            <DialogDescription>
              {t("Sfoglia le esecuzioni precedenti, visualizza output, scarica o elimina.", "Browse previous OCR runs, inspect output, download, or delete saved runs.")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 flex-1 min-h-0 min-w-0 overflow-y-auto lg:overflow-hidden">
            <Card className="min-h-0 min-w-0 flex flex-col">
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm">{t("Cronologia", "History")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                {isLoadingHistory ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : historyJobs.length === 0 ? (
                  <div className="h-full flex items-center justify-center p-4 text-center">
                    <p className="text-sm text-muted-foreground">{t("Nessuna esecuzione OCR salvata.", "No OCR runs saved yet.")}</p>
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="p-2 space-y-1">
                      {historyJobs.map((job) => (
                        <motion.button
                          key={job.id}
                          type="button"
                          onClick={() => setSelectedHistoryId(job.id)}
                          whileHover={{ x: 2, scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          transition={{ duration: 0.15 }}
                          className={cn(
                            "w-full text-left p-2 rounded-md border transition-colors",
                            selectedHistoryId === job.id
                              ? "border-primary/40 bg-primary/10"
                              : "border-transparent hover:bg-muted"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium truncate">{job.fileName}</p>
                            <Badge
                              variant={
                                job.status === "FAILED"
                                  ? "destructive"
                                  : job.status === "COMPLETED"
                                    ? "secondary"
                                    : "outline"
                              }
                              className="text-[10px]"
                            >
                              {job.status === "FAILED"
                                ? t("fallito", "failed")
                                : job.status === "COMPLETED"
                                  ? t("completato", "completed")
                                  : t("in corso", "running")}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{job.model}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatTimestamp(job.createdAt)}
                          </p>
                        </motion.button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="min-h-0 min-w-0 flex flex-col">
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm">{t("Dettagli esecuzione", "Run Details")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                {isLoadingHistoryDetail ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !selectedHistoryJob ? (
                  <div className="h-full flex items-center justify-center p-4 text-center">
                    <p className="text-sm text-muted-foreground">{t("Seleziona un'esecuzione per vedere i dettagli.", "Select a run to view details.")}</p>
                  </div>
                ) : (
                  <div className="h-full flex flex-col min-h-0 min-w-0">
                    <div className="p-4 border-b space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium truncate">{selectedHistoryJob.fileName}</p>
                        <Badge
                          variant={
                            selectedHistoryJob.status === "FAILED"
                              ? "destructive"
                              : selectedHistoryJob.status === "COMPLETED"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {selectedHistoryJob.status === "FAILED"
                            ? t("fallito", "failed")
                            : selectedHistoryJob.status === "COMPLETED"
                              ? t("completato", "completed")
                              : t("in corso", "running")}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("Modello", "Model")}: {selectedHistoryJob.model}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("Creato", "Created")}: {formatTimestamp(selectedHistoryJob.createdAt)}
                      </p>
                      {selectedHistoryObsidianPath ? (
                        <p className="text-xs text-muted-foreground break-all">
                          {t("Vault Obsidian", "Obsidian vault")}: {selectedHistoryObsidianPath}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid xl:grid-cols-[240px_minmax(0,1fr)] flex-1 min-h-0 min-w-0">
                      <div className="border-r p-3 flex items-center justify-center bg-muted/20">
                        {selectedHistoryJob.sourcePreview ? (
                          <img
                            src={selectedHistoryJob.sourcePreview}
                            alt={selectedHistoryJob.fileName}
                            className="max-h-[220px] max-w-full object-contain rounded-md"
                          />
                        ) : (
                          <div className="text-center text-muted-foreground">
                            <ImageOff className="h-8 w-8 mx-auto mb-2" />
                            <p className="text-xs">{t("Anteprima non disponibile", "No preview saved")}</p>
                          </div>
                        )}
                      </div>
                      <Tabs defaultValue="markdown" className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
                        <div className="px-3 pt-2 border-b">
                          <TabsList className="h-8 w-full justify-start overflow-x-auto">
                            <TabsTrigger value="markdown" className="text-xs h-6 shrink-0 gap-1.5 group">
                              <FileText className="h-3 w-3 text-emerald-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110" />
                              Markdown
                            </TabsTrigger>
                            <TabsTrigger value="markdown-raw" className="text-xs h-6 shrink-0 gap-1.5 group">
                              <FileText className="h-3 w-3 text-lime-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110" />
                              {t("Markdown grezzo", "Markdown raw")}
                            </TabsTrigger>
                            <TabsTrigger value="json" className="text-xs h-6 shrink-0 gap-1.5 group">
                              <Code className="h-3 w-3 text-cyan-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110" />
                              JSON
                            </TabsTrigger>
                          </TabsList>
                        </div>
                        <TabsContent value="markdown" className="flex-1 m-0 min-h-0 min-w-0">
                          <ScrollArea className="h-full w-full">
                            <div className="prose prose-sm dark:prose-invert max-w-none p-4 break-words [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:break-words">
                              <ReactMarkdown>{selectedHistoryMarkdown}</ReactMarkdown>
                            </div>
                          </ScrollArea>
                        </TabsContent>
                        <TabsContent value="markdown-raw" className="flex-1 m-0 min-h-0 min-w-0">
                          <ScrollArea className="h-full w-full">
                            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {selectedHistoryMarkdown}
                            </pre>
                          </ScrollArea>
                        </TabsContent>
                        <TabsContent value="json" className="flex-1 m-0 min-h-0 min-w-0">
                          <ScrollArea className="h-full w-full">
                            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {JSON.stringify(selectedHistoryStructuredJson, null, 2)}
                            </pre>
                          </ScrollArea>
                        </TabsContent>
                      </Tabs>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => downloadHistoryResult("md")}
              disabled={!selectedHistoryJob}
              className="group"
            >
              <Download className="h-4 w-4 mr-1.5 text-emerald-400 transition-transform duration-200 group-hover:-translate-y-0.5" />
              {t("Scarica MD", "Download MD")}
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadHistoryResult("json")}
              disabled={!selectedHistoryJob}
              className="group"
            >
              <Download className="h-4 w-4 mr-1.5 text-cyan-400 transition-transform duration-200 group-hover:-translate-y-0.5" />
              {t("Scarica JSON", "Download JSON")}
            </Button>
            <Button
              variant="destructive"
              onClick={deleteHistoryJob}
              disabled={!selectedHistoryId || isDeletingHistory}
              className="group"
            >
              {isDeletingHistory ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5 transition-transform duration-200 group-hover:scale-110" />}
              {t("Elimina esecuzione", "Delete Run")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <main className="flex-1 min-h-0 overflow-y-auto scrollbar-hide lg:overflow-hidden container mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-[420px_1fr] gap-6 min-h-0 lg:h-full">
          {/* Left Panel - File Upload & List */}
          <motion.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col gap-4 min-h-0 lg:overflow-y-auto lg:scrollbar-hide lg:pr-1"
          >
            {/* Upload Area */}
            <Card
              className={cn(
                "border-2 border-dashed transition-all duration-300 cursor-pointer",
                isDragOver
                  ? "border-primary bg-primary/5 scale-[1.02]"
                  : "border-border hover:border-primary/50"
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <CardContent className="flex flex-col items-center justify-center py-8 px-4">
                <motion.div
                  animate={isDragOver ? { scale: 1.1, y: -5 } : { scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 300 }}
                >
                  <div className="relative">
                    <Upload className="h-10 w-10 text-muted-foreground mb-3" />
                    <motion.div
                      className="absolute -top-1 -right-1"
                      animate={{ rotate: [0, 10, -10, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      <FileUp className="h-4 w-4 text-primary" />
                    </motion.div>
                  </div>
                </motion.div>
                <p className="text-sm font-medium mb-1">
                  {isDragOver ? t("Rilascia qui i file", "Drop files here") : t("Trascina i documenti o clicca per caricare", "Drop documents or click to upload")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("Supporta immagini, PDF e documenti", "Supports images, PDFs, and documents")}
                </p>
              </CardContent>
            </Card>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />

            {/* File List */}
            <Card className="min-h-0 overflow-hidden lg:flex-1">
              <CardContent className="p-0 flex flex-col min-h-0">
                {/* File List Header */}
                <div className="flex items-center justify-between p-3 border-b">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-indigo-400" />
                    <span className="text-sm font-medium">
                      {files.length} {t(files.length !== 1 ? "file" : "file", files.length !== 1 ? "files" : "file")}
                    </span>
                    {completedCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {t(`${completedCount} completati`, `${completedCount} done`)}
                      </Badge>
                    )}
                    {errorCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {t(`${errorCount} falliti`, `${errorCount} failed`)}
                      </Badge>
                    )}
                  </div>
                  {files.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground hover:text-destructive group"
                        onClick={clearAllFiles}
                      >
                        <Trash2 className="h-3 w-3 mr-1 transition-transform duration-200 group-hover:scale-110" />
                        {t("Pulisci", "Clear")}
                      </Button>
                  )}
                </div>

                {/* File List Items or Empty State */}
                {files.length > 0 ? (
                  <ScrollArea className="flex-1 max-h-[200px]">
                    <div className="p-2 space-y-1">
                      <AnimatePresence initial={false}>
                        {files.map((file, index) => (
                          <motion.div
                            key={file.id}
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2, delay: index * 0.05 }}
                            className={cn(
                              "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                              selectedFileId === file.id
                                ? "bg-primary/10 border border-primary/20"
                                : "hover:bg-muted/50"
                            )}
                            onClick={() => setSelectedFileId(file.id)}
                          >
                            {/* Preview or Icon */}
                            <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                              {file.preview ? (
                                <img
                                  src={file.preview}
                                  alt={file.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <FileText className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>

                            {/* File Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{file.name}</p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {formatFileSize(file.size)}
                                </span>
                                {typeof file.pageCount === "number" ? (
                                  <span className="text-[11px] text-muted-foreground">
                                    {file.pageCount} {t(file.pageCount === 1 ? "pagina" : "pagine", file.pageCount === 1 ? "page" : "pages")}
                                  </span>
                                ) : null}
                                {file.status === "processing" && (
                                  <div className="flex items-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                    <span className="text-xs text-primary">{file.progress}%</span>
                                  </div>
                                )}
                                {file.status === "paused" ? (
                                  <div className="flex items-center gap-1">
                                    <PauseCircle className="h-3 w-3 text-amber-500" />
                                    <span className="text-xs text-amber-600">{t("in pausa", "paused")}</span>
                                  </div>
                                ) : null}
                              </div>
                              {(file.status === "processing" || file.status === "paused") && (
                                <>
                                  <Progress value={file.progress} className="h-1 mt-1" />
                                  <div className="flex items-center justify-between mt-1">
                                    <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                                      {file.stageMessage || (file.status === "paused" ? t("In pausa", "Paused") : t("In lavorazione", "Working"))}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground">
                                      {t("ETA", "ETA")} {formatEta(file.etaSeconds)}
                                    </span>
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Status Icon */}
                            <div className="flex-shrink-0">
                              {file.status === "completed" && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={{ type: "spring", stiffness: 400 }}
                                >
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                </motion.div>
                              )}
                              {file.status === "error" && (
                                <AlertCircle className="h-4 w-4 text-destructive" />
                              )}
                              {file.status === "paused" && (
                                <PauseCircle className="h-4 w-4 text-amber-500" />
                              )}
                              {file.status === "pending" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeFile(file.id);
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="flex-1 flex items-center justify-center py-8">
                    <div className="text-center">
                      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
                        <FileText className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium">{t("Nessun file", "No files yet")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("Carica documenti per iniziare", "Upload documents to start")}
                      </p>
                    </div>
                  </div>
                )}

                {/* Process Button */}
                <div className="p-3 border-t space-y-2 shrink-0 bg-card">
                  <Button
                    className="w-full group"
                    onClick={processFiles}
                    disabled={
                      isProcessing ||
                      pendingCount === 0 ||
                      !selectedModel.trim() ||
                      !isRunReady ||
                      activeProcessingFile !== null
                    }
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {runMode === "pdf_to_obsidian"
                          ? t("Elaborazione PDF→Obsidian...", "Running PDF→Obsidian...")
                          : t("Elaborazione...", "Processing...")}
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-2 text-amber-300 transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6" />
                        {runMode === "pdf_to_obsidian"
                          ? t(
                              `Avvia PDF→Obsidian (${pendingCount} in attesa)`,
                              `Run PDF→Obsidian (${pendingCount} pending)`
                            )
                          : t(`Avvia OCR (${pendingCount} in attesa)`, `Run OCR (${pendingCount} pending)`)}
                      </>
                    )}
                  </Button>
                  {activeProcessingFile ? (
                    <Button
                      variant="outline"
                      className="w-full group"
                      onClick={() => stopProcessingFile(activeProcessingFile)}
                    >
                      <PauseCircle className="h-4 w-4 mr-2 text-amber-500 transition-transform duration-200 group-hover:scale-110" />
                      {t("Ferma OCR corrente", "Stop Current OCR")}
                    </Button>
                  ) : null}
                  {resumableSelectedFile ? (
                    <Button
                      variant="secondary"
                      className="w-full group"
                      onClick={() => resumeProcessingFile(resumableSelectedFile)}
                    >
                      <PlayCircle className="h-4 w-4 mr-2 text-emerald-400 transition-transform duration-200 group-hover:scale-110" />
                      {t("Riprendi dal checkpoint", "Resume From Checkpoint")}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {/* Advanced Settings */}
            <Collapsible open={advancedSettingsOpen} onOpenChange={setAdvancedSettingsOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-amber-400" />
                        {t("Impostazioni avanzate", "Advanced Settings")}
                      </CardTitle>
                      <motion.div
                        animate={{ rotate: advancedSettingsOpen ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                      >
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </motion.div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 px-3 pb-3 space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs">{t("Modalità", "Mode")}</Label>
                      <Select value={runMode} onValueChange={(value) => setRunMode(value as OcrRunMode)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ocr" className="text-xs">
                            {t("OCR standard", "Standard OCR")}
                          </SelectItem>
                          <SelectItem value="pdf_to_obsidian" className="text-xs">
                            {t("PDF → Obsidian", "PDF → Obsidian")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Language Selection */}
                    <div className="space-y-2">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Languages className="h-3 w-3" />
                        {t("Lingua documento", "Document Language")}
                      </Label>
                      <Select
                        value={settings.language}
                        onValueChange={(v) => setSettings((s) => ({ ...s, language: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LANGUAGES.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code} className="text-xs">
                              {uiLanguage === "it" ? lang.nameIt : lang.nameEn}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Toggle Settings */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{t("Rilevamento tabelle", "Table Detection")}</Label>
                        <Switch
                          checked={settings.tableDetection}
                          onCheckedChange={(v) => setSettings((s) => ({ ...s, tableDetection: v }))}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{t("Riconoscimento scrittura a mano", "Handwriting Recognition")}</Label>
                        <Switch
                          checked={settings.handwritingRecognition}
                          onCheckedChange={(v) => setSettings((s) => ({ ...s, handwritingRecognition: v }))}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{t("Mantieni formattazione", "Preserve Formatting")}</Label>
                        <Switch
                          checked={settings.preserveFormatting}
                          onCheckedChange={(v) => setSettings((s) => ({ ...s, preserveFormatting: v }))}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                    </div>

                    {/* Quality Slider */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{t("Qualità output", "Output Quality")}</Label>
                        <span className="text-xs text-muted-foreground">{settings.quality}%</span>
                      </div>
                      <Slider
                        value={[settings.quality]}
                        onValueChange={([v]) => setSettings((s) => ({ ...s, quality: v }))}
                        min={50}
                        max={100}
                        step={10}
                        className="py-2"
                      />
                    </div>

                    {/* Custom Prompt */}
                    <div className="space-y-2">
                      <Label className="text-xs">{t("Istruzioni personalizzate", "Custom Instructions")}</Label>
                      <Textarea
                        placeholder={t("Aggiungi istruzioni OCR personalizzate...", "Add custom OCR instructions...")}
                        value={settings.customPrompt}
                        onChange={(e) => setSettings((s) => ({ ...s, customPrompt: e.target.value }))}
                        className="h-16 text-xs resize-none"
                      />
                    </div>

                    <Separator />

                    {runMode === "pdf_to_obsidian" ? (
                      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                        <div className="flex items-start gap-2">
                          <FolderOpen className="h-4 w-4 mt-0.5 text-violet-400" />
                          <p className="text-[11px] text-muted-foreground">
                            {t(
                              "In questa modalità il post-processing è obbligatorio e genera automaticamente una struttura Obsidian per argomenti.",
                              "In this mode post-processing is mandatory and automatically generates an Obsidian topic-based structure."
                            )}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">{t("Percorso root vault", "Vault root path")}</Label>
                          <Input
                            value={obsidianSettings.vaultRoot}
                            onChange={(event) =>
                              setObsidianSettings((prev) => ({
                                ...prev,
                                vaultRoot: event.target.value,
                              }))
                            }
                            placeholder={DEFAULT_OBSIDIAN_VAULT_ROOT}
                            className="h-8 text-xs"
                          />
                          <p className="text-[10px] text-muted-foreground">
                            {t(
                              "Percorso host o percorso montato nel container dove creare nuovi vault.",
                              "Host path or container-mounted path where new vaults will be created."
                            )}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">{t("Prefisso nome vault (opzionale)", "Vault name prefix (optional)")}</Label>
                          <Input
                            value={obsidianSettings.vaultNamePrefix}
                            onChange={(event) =>
                              setObsidianSettings((prev) => ({
                                ...prev,
                                vaultNamePrefix: event.target.value,
                              }))
                            }
                            placeholder="project-notes"
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">{t("Istruzione organizzazione (opzionale)", "Organization instruction (optional)")}</Label>
                          <Textarea
                            placeholder={t(
                              "Esempio: crea cartelle per cliente, fatture, scadenze e una nota riepilogo con task.",
                              "Example: create folders for client, invoices, deadlines, and a summary note with tasks."
                            )}
                            value={obsidianSettings.instruction}
                            onChange={(event) =>
                              setObsidianSettings((prev) => ({
                                ...prev,
                                instruction: event.target.value,
                              }))
                            }
                            className="h-20 text-xs resize-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">{t("Modello analisi Obsidian", "Obsidian analysis model")}</Label>
                          <Select
                            value={obsidianModelValue}
                            onValueChange={(value) =>
                              setObsidianSettings((prev) => ({
                                ...prev,
                                model: value === "__same__" ? "" : value,
                              }))
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__same__" className="text-xs">
                                {t(`Uguale al modello OCR (${selectedModel})`, `Same as OCR model (${selectedModel})`)}
                              </SelectItem>
                              {!selectedObsidianModelExists && obsidianSettings.model ? (
                                <SelectItem value={obsidianSettings.model} className="text-xs">
                                  {obsidianSettings.model}
                                </SelectItem>
                              ) : null}
                              {models.map((model) => (
                                <SelectItem key={`obsidian-model-${model.id}`} value={model.id} className="text-xs">
                                  {model.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">{t("Includi note per pagina", "Include per-page notes")}</Label>
                          <Switch
                            checked={obsidianSettings.includePageNotes}
                            onCheckedChange={(checked) =>
                              setObsidianSettings((prev) => ({
                                ...prev,
                                includePageNotes: checked,
                              }))
                            }
                            className="data-[state=checked]:bg-primary"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <Label className="text-xs">{t("Post-processing", "Post-processing")}</Label>
                            <p className="text-[11px] text-muted-foreground">
                              {t("Applica un passaggio modello aggiuntivo dopo l'estrazione OCR.", "Apply an extra model step after OCR extraction.")}
                            </p>
                          </div>
                          <Switch
                            checked={postProcessing.enabled}
                            onCheckedChange={(enabled) =>
                              setPostProcessing((prev) => ({ ...prev, enabled }))
                            }
                            className="data-[state=checked]:bg-primary"
                          />
                        </div>

                        {postProcessing.enabled ? (
                          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                            <div className="space-y-2">
                              <Label className="text-xs">{t("Istruzione", "Instruction")}</Label>
                              <Textarea
                                placeholder={t("Esempio: estrai numero fattura, scadenza e totali da ogni pagina e restituisci una tabella normalizzata.", "Example: Extract invoice number, due date, and totals from each page, then return one normalized table.")}
                                value={postProcessing.instruction}
                                onChange={(event) =>
                                  setPostProcessing((prev) => ({
                                    ...prev,
                                    instruction: event.target.value,
                                  }))
                                }
                                className="h-24 text-xs resize-none"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">{t("Modello post-processing", "Post-processing model")}</Label>
                              <Select
                                value={postProcessModelValue}
                                onValueChange={(value) =>
                                  setPostProcessing((prev) => ({
                                    ...prev,
                                    model: value === "__same__" ? "" : value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__same__" className="text-xs">
                                    {t(`Uguale al modello OCR (${selectedModel})`, `Same as OCR model (${selectedModel})`)}
                                  </SelectItem>
                                  {!selectedPostProcessModelExists && postProcessing.model ? (
                                    <SelectItem value={postProcessing.model} className="text-xs">
                                      {postProcessing.model}
                                    </SelectItem>
                                  ) : null}
                                  {models.map((model) => (
                                    <SelectItem key={`post-model-${model.id}`} value={model.id} className="text-xs">
                                      {model.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs">{t("Formato output", "Output format")}</Label>
                              <Select
                                value={postProcessing.outputFormat}
                                onValueChange={(value: PostProcessOutputFormat) =>
                                  setPostProcessing((prev) => ({ ...prev, outputFormat: value }))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="markdown" className="text-xs">
                                    Markdown
                                  </SelectItem>
                                  <SelectItem value="json" className="text-xs">
                                    {t("JSON strutturato", "Structured JSON")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </motion.div>

          {/* Right Panel - Preview */}
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="flex flex-col min-h-[500px] lg:min-h-0"
          >
            {selectedFile ? (
              <Card className="flex-1 flex flex-col min-h-0">
                <CardContent className="flex-1 flex flex-col p-0 min-h-0">
                  {/* Preview Header */}
                  <div className="flex items-center justify-between p-3 border-b">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate max-w-[180px]">
                        {selectedFile.name}
                      </span>
                      {selectedFile.status === "completed" && (
                            <Badge variant="outline" className="text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-500" />
                              {t("Completato", "Completed")}
                            </Badge>
                          )}
                          {selectedFile.status === "completed" && selectedFileObsidianPath ? (
                            <Badge variant="secondary" className="text-[10px] max-w-[280px] truncate">
                              <FolderOpen className="h-3 w-3 mr-1 text-violet-400" />
                              {selectedFileObsidianPath}
                            </Badge>
                          ) : null}
                          {selectedFile.status === "paused" && (
                            <Badge variant="outline" className="text-xs">
                              <PauseCircle className="h-3 w-3 mr-1 text-amber-500" />
                              {t("In pausa", "Paused")}
                            </Badge>
                          )}
                    </div>
                    <div className="flex items-center gap-1">
                      {/* View Mode Toggle */}
                      {selectedFile.result && (
                        <>
                          <Button
                            variant={viewMode === "preview" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-2 group"
                            onClick={() => setViewMode("preview")}
                          >
                            <Eye className="h-3.5 w-3.5 text-sky-400 transition-transform duration-200 group-hover:scale-110" />
                          </Button>
                          <Button
                            variant={viewMode === "split" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-2 group"
                            onClick={() => setViewMode("split")}
                          >
                            <Columns className="h-3.5 w-3.5 text-violet-400 transition-transform duration-200 group-hover:scale-110" />
                          </Button>
                          <Button
                            variant={viewMode === "result" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-2 group"
                            onClick={() => setViewMode("result")}
                          >
                            <FileText className="h-3.5 w-3.5 text-emerald-400 transition-transform duration-200 group-hover:scale-110" />
                          </Button>
                          <Separator orientation="vertical" className="h-5 mx-1" />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 group"
                            onClick={() => copyToClipboard("md")}
                          >
                            {copied === "md" ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 text-cyan-400 transition-transform duration-200 group-hover:scale-110" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 group"
                            onClick={() => downloadResult("md")}
                          >
                            <Download className="h-3.5 w-3.5 text-emerald-400 transition-transform duration-200 group-hover:-translate-y-0.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Content Area */}
                  {selectedFile.status === "completed" && selectedFile.result ? (
                    <div className="flex-1 flex min-h-0">
                      {/* Document Preview */}
                      {(viewMode === "preview" || viewMode === "split") && (
                        <div
                          className={cn(
                            "flex flex-col min-h-0",
                            viewMode === "split" ? "w-[58%] border-r" : "flex-1"
                          )}
                        >
                          <div className="px-3 py-2 border-b bg-muted/30">
                            <span className="text-xs font-medium text-muted-foreground">{t("Anteprima documento", "Document Preview")}</span>
                          </div>
                          <ScrollArea className="flex-1">
                            <div className="p-4 flex items-center justify-center min-h-full">
                              {selectedFile.preview ? (
                                <motion.img
                                  initial={{ opacity: 0, scale: 0.95 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  src={selectedFile.preview}
                                  alt={selectedFile.name}
                                  className="max-w-full max-h-[78vh] object-contain rounded-md shadow-sm"
                                />
                              ) : (
                                <div className="flex flex-col items-center text-muted-foreground">
                                  <ImageOff className="h-12 w-12 mb-2" />
                                  <p className="text-sm">{t("Anteprima non disponibile", "No preview available")}</p>
                                  <p className="text-xs">{t("Impossibile generare l'anteprima", "Preview could not be generated")}</p>
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      )}

                      {/* OCR Results */}
                      {(viewMode === "result" || viewMode === "split") && (
                        <div
                          className={cn(
                            "flex flex-col min-h-0",
                            viewMode === "split" ? "w-[42%]" : "flex-1"
                          )}
                        >
                          <Tabs defaultValue="markdown" className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
                            <div className="px-3 pt-2 border-b">
                              <TabsList className="h-8 w-full justify-start overflow-x-auto">
                                <TabsTrigger value="markdown" className="text-xs gap-1.5 h-6 shrink-0 group">
                                  <FileText className="h-3 w-3 text-emerald-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110" />
                                  Markdown
                                </TabsTrigger>
                                <TabsTrigger value="markdown-raw" className="text-xs gap-1.5 h-6 shrink-0 group">
                                  <FileText className="h-3 w-3 text-lime-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110" />
                                  {t("Markdown grezzo", "Markdown raw")}
                                </TabsTrigger>
                                <TabsTrigger value="json" className="text-xs gap-1.5 h-6 shrink-0 group">
                                  <Code className="h-3 w-3 text-cyan-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110" />
                                  JSON
                                </TabsTrigger>
                              </TabsList>
                            </div>

                            <TabsContent value="markdown" className="flex-1 m-0 min-h-0 min-w-0">
                              <ScrollArea className="h-full w-full">
                                <div className="prose prose-sm dark:prose-invert max-w-none p-4 break-words [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:break-words">
                                  <ReactMarkdown>{selectedFileMarkdown}</ReactMarkdown>
                                </div>
                              </ScrollArea>
                            </TabsContent>

                            <TabsContent value="markdown-raw" className="flex-1 m-0 min-h-0 min-w-0">
                              <ScrollArea className="h-full w-full">
                                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                  {selectedFileMarkdown}
                                </pre>
                              </ScrollArea>
                            </TabsContent>

                            <TabsContent value="json" className="flex-1 m-0 min-h-0 min-w-0">
                              <ScrollArea className="h-full w-full">
                                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                  {JSON.stringify(selectedFileStructuredJson, null, 2)}
                                </pre>
                              </ScrollArea>
                            </TabsContent>
                          </Tabs>
                        </div>
                      )}
                    </div>
                  ) : selectedFile.status === "processing" || selectedFile.status === "paused" ? (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <div className="p-4 border-b space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">
                              {selectedFile.status === "paused" ? t("OCR in pausa", "OCR Paused") : t("OCR in elaborazione", "Processing OCR")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {selectedFile.stageMessage || t("Esecuzione pipeline di estrazione", "Running extraction pipeline")}
                            </p>
                          </div>
                          <Badge variant={selectedFile.status === "paused" ? "outline" : "secondary"}>
                            {selectedFile.status === "paused" ? t("in pausa", "paused") : t("in esecuzione", "running")}
                          </Badge>
                        </div>
                        <Progress value={selectedFile.progress} className="w-full" />
                        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <ListChecks className="h-3.5 w-3.5" />
                            <span>
                              {selectedFile.processedPages || 0}/{selectedFile.pageCount || 0} {t("pagine", "pages")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Clock3 className="h-3.5 w-3.5" />
                            <span>{t("ETA", "ETA")} {formatEta(selectedFile.etaSeconds)}</span>
                          </div>
                          <div className="truncate">
                            {models.find((m) => m.id === selectedModel)?.name || selectedModel}
                          </div>
                        </div>
                      </div>
                      <div className="grid md:grid-cols-[1fr_280px] flex-1 min-h-0">
                        <ScrollArea className="h-full border-r">
                          <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                            {(selectedFile.pagePreviews || []).map((preview, index) => {
                              const pageNumber = index + 1;
                              const processed =
                                typeof selectedFile.processedPages === "number" &&
                                selectedFile.processedPages >= pageNumber;
                              const checkpoint = selectedFile.checkpoints?.find(
                                (item) => item.pageNumber === pageNumber
                              );
                              return (
                                <div
                                  key={`${selectedFile.id}-page-${pageNumber}`}
                                  className={cn(
                                    "rounded-md border p-2 space-y-2",
                                    processed ? "border-emerald-400/50 bg-emerald-50/20" : "border-border"
                                  )}
                                >
                                  <img
                                    src={preview}
                                    alt={`${selectedFile.name} ${t("pagina", "page")} ${pageNumber}`}
                                    className="w-full h-24 object-cover rounded"
                                  />
                                  <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium">{t("Pagina", "Page")} {pageNumber}</p>
                                    <Badge variant={processed ? "secondary" : "outline"} className="text-[10px]">
                                      {processed ? t("fatto", "done") : t("in coda", "queued")}
                                    </Badge>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground line-clamp-3">
                                    {checkpoint?.previewText || t("In attesa di estrazione...", "Waiting for extraction...")}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                        <ScrollArea className="h-full">
                          <div className="p-4 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              {t("Attività modello in tempo reale", "Live model activity")}
                            </p>
                            {(selectedFile.events || []).length > 0 ? (
                              [...(selectedFile.events || [])]
                                .reverse()
                                .slice(0, 18)
                                .map((event, idx) => (
                                  <div
                                    key={`${event.at || "event"}-${idx}`}
                                    className="rounded border bg-muted/20 p-2"
                                  >
                                    <p className="text-[11px] font-medium">
                                      {event.stage || "stage"}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {event.message || ""}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {event.at ? formatTimestamp(event.at) : ""}
                                    </p>
                                  </div>
                                ))
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                {t("In attesa di eventi di avanzamento...", "Waiting for progress events...")}
                              </p>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  ) : selectedFile.status === "error" ? (
                    <div className="flex-1 flex items-center justify-center">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-center"
                      >
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
                          <AlertCircle className="h-8 w-8 text-destructive" />
                        </div>
                        <p className="text-sm font-medium mb-1">{t("Elaborazione non riuscita", "Processing Failed")}</p>
                        <p className="text-xs text-muted-foreground max-w-xs">
                          {selectedFile.error || t("Si è verificato un errore durante l'elaborazione OCR", "An error occurred during OCR processing")}
                        </p>
                      </motion.div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      {/* Show preview for pending files */}
                      {selectedFile.preview ? (
                        <div className="flex flex-col items-center justify-center w-full p-6">
                          <motion.img
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            src={selectedFile.preview}
                            alt={selectedFile.name}
                            className="max-w-full max-h-[400px] object-contain rounded-md shadow-sm mb-4"
                          />
                          <p className="text-sm font-medium mb-1">{t("Pronto per OCR", "Ready for OCR")}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('Clicca "Avvia OCR" per estrarre il testo da questo documento', 'Click "Run OCR" to extract text from this document')}
                          </p>
                        </div>
                      ) : (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-center"
                        >
                          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                            <ScanLine className="h-8 w-8 text-muted-foreground" />
                          </div>
                          <p className="text-sm font-medium mb-1">{t("Pronto per OCR", "Ready for OCR")}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('Clicca "Avvia OCR" per estrarre il testo', 'Click "Run OCR" to extract text')}
                          </p>
                        </motion.div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="flex-1 flex items-center justify-center">
                <CardContent className="text-center py-10">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                      <Sparkles className="h-10 w-10 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">{t("Seleziona un documento", "Select a document")}</h3>
                    <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                      {t("Carica file e selezionane uno per vedere il risultato OCR", "Upload files and select one to view the OCR extraction results")}
                    </p>
                  </motion.div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <motion.footer
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="border-t mt-auto"
      >
        <div className="container mx-auto px-4 h-14 flex items-center">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Estracto.
          </p>
        </div>
      </motion.footer>
    </div>
  );
}

// ChevronDown icon component
function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
