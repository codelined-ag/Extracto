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

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
const DEFAULT_MISTRAL_ENDPOINT = "https://api.mistral.ai/v1/ocr";

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
};

// Fallback list before first model fetch
const FALLBACK_MODELS: Model[] = [
  { id: "llama3.2-vision:latest", name: "Llama 3.2 Vision", provider: "ollama" },
  { id: "llava:latest", name: "LLaVA", provider: "ollama" },
  { id: "minicpm-v:latest", name: "MiniCPM-V", provider: "ollama" },
  { id: "mistral-ocr-latest", name: "Mistral OCR (latest)", provider: "mistral" },
  { id: "pixtral-12b", name: "Pixtral 12B", provider: "mistral" },
];

// Languages
const LANGUAGES = [
  { code: "auto", name: "Auto Detect" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
];

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
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const typed = payload as Record<string, unknown>;
  if (typeof typed.markdown === "string" && typed.markdown.trim()) {
    return typed.markdown;
  }

  if (
    typed.structured &&
    typeof typed.structured === "object" &&
    !Array.isArray(typed.structured) &&
    typeof (typed.structured as Record<string, unknown>).markdown === "string" &&
    ((typed.structured as Record<string, unknown>).markdown as string).trim()
  ) {
    return (typed.structured as Record<string, unknown>).markdown as string;
  }

  if (typeof typed.text === "string" && typed.text.trim()) {
    return typed.text;
  }

  return fallback;
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
  const [selectedModel, setSelectedModel] = React.useState<string>(FALLBACK_MODELS[0].id);
  const [models, setModels] = React.useState<Model[]>(FALLBACK_MODELS);
  const [apiSettings, setApiSettings] = React.useState<ApiSettings>(DEFAULT_API_SETTINGS);
  const [apiSettingsDraft, setApiSettingsDraft] = React.useState<ApiSettings>(DEFAULT_API_SETTINGS);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<"md" | "json" | null>(null);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = React.useState(true);
  const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"preview" | "split" | "result">("split");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [isSavingApiSettings, setIsSavingApiSettings] = React.useState(false);
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

  const selectedFile = files.find((f) => f.id === selectedFileId);
  const selectedFileMarkdown = selectedFile?.result
    ? getMarkdownFromJsonPayload(selectedFile.result.json, selectedFile.result.text)
    : "";
  const selectedFileStructuredJson = selectedFile?.result
    ? getStructuredJsonPayload(selectedFile.result.json)
    : {};
  const selectedHistoryMarkdown = selectedHistoryJob
    ? getMarkdownFromJsonPayload(selectedHistoryJob.result, selectedHistoryJob.extractedText || "")
    : "";
  const selectedHistoryStructuredJson = selectedHistoryJob
    ? getStructuredJsonPayload(selectedHistoryJob.result)
    : {};
  const completedCount = files.filter((f) => f.status === "completed").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const pendingCount = files.filter((f) => f.status === "pending").length;
  const activeProcessingFile = files.find((f) => f.status === "processing") || null;
  const resumableSelectedFile = selectedFile?.status === "paused" ? selectedFile : null;
  const isPostProcessingReady =
    !postProcessing.enabled || postProcessing.instruction.trim().length > 0;
  const postProcessModelValue = postProcessing.model || "__same__";
  const selectedPostProcessModelExists = postProcessing.model
    ? models.some((model) => model.id === postProcessing.model)
    : true;

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
        const nextModels =
          discoveredModels.length > 0 ? discoveredModels : FALLBACK_MODELS;

        setModels(nextModels);
        setSelectedModel((current) =>
          nextModels.some((model) => model.id === current) ? current : nextModels[0]?.id || ""
        );
        return nextModels;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to fetch models";
        setModelError(message);
        setModels(FALLBACK_MODELS);
        setSelectedModel((current) =>
          FALLBACK_MODELS.some((model) => model.id === current)
            ? current
            : FALLBACK_MODELS[0]?.id || ""
        );
        toast({
          title: "Model fetch failed",
          description: message,
          variant: "destructive",
        });
        return FALLBACK_MODELS;
      } finally {
        setIsLoadingModels(false);
      }
    },
    [toast]
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
      };
      setApiSettings(normalizedSettings);
      setApiSettingsDraft(normalizedSettings);
      await fetchAvailableModels(normalizedSettings);
    } catch (error) {
      setApiSettings(DEFAULT_API_SETTINGS);
      setApiSettingsDraft(DEFAULT_API_SETTINGS);
      await fetchAvailableModels(DEFAULT_API_SETTINGS);
      toast({
        title: "Settings load failed",
        description:
          error instanceof Error
            ? error.message
            : "Unable to load API settings, using defaults",
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
      };

      setApiSettings(normalizedSettings);
      setApiSettingsOpen(false);
      await fetchAvailableModels(normalizedSettings);
      toast({
        title: "Settings saved",
        description: "API configuration has been updated",
      });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Unable to save API settings",
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
        title: "History load failed",
        description: error instanceof Error ? error.message : "Unable to load OCR history",
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
        title: "Run load failed",
        description: error instanceof Error ? error.message : "Unable to load OCR run",
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
        title: "Run deleted",
        description: "Past OCR run removed from history",
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Unable to delete OCR run",
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
    void loadSavedSettings();
  }, [loadSavedSettings]);

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
      title: "Files added",
      description: `${newFiles.length} file(s) ready for OCR processing`,
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
      title: "Copied to clipboard!",
      description: `${type === "md" ? "Markdown" : "JSON"} content has been copied`,
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
      title: "Download started",
      description: `${selectedFile.name}.${type === "md" ? "md" : "json"} is being downloaded`,
    });
  };

  // Export all as zip
  const exportAllAsZip = async () => {
    const completedFiles = files.filter((f) => f.status === "completed" && f.result);
    if (completedFiles.length === 0) {
      toast({
        title: "No files to export",
        description: "Process some files first before exporting",
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
      title: "Export complete!",
      description: `${completedFiles.length} files exported to ZIP archive`,
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
                      ? job.errorMessage || "Processing failed"
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
        throw new Error(job.errorMessage || "Processing failed");
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
        preview: pagePreviews[0],
        pages: pagePreviews,
        settings,
        postProcessing,
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
                ? "Resuming from checkpoint..."
                : `Queued for OCR (${pagePreviews.length} pages)`,
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
    if (!isPostProcessingReady) {
      toast({
        title: "Missing post-processing instruction",
        description: "Add an instruction or disable post-processing before running OCR.",
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
        } else if (result.status === "paused") {
          toast({
            title: "OCR paused",
            description: `${file.name} paused at checkpoint. Click Resume to continue.`,
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
                  error: error instanceof Error ? error.message : "Processing failed",
                }
              : entry
          )
        );
      }
    }

    setIsProcessing(false);
    if (completedInRun > 0) {
      toast({
        title: "Processing complete",
        description: `${completedInRun} file(s) processed successfully`,
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
                stageMessage: "Stop requested. Finishing current page...",
              }
            : entry
        )
      );
      toast({
        title: "Stop requested",
        description: "Current page will finish, then OCR will pause and unload the model.",
      });
    } catch (error) {
      toast({
        title: "Stop failed",
        description: error instanceof Error ? error.message : "Unable to stop OCR",
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
          title: "Resume complete",
          description: `${file.name} resumed and finished successfully.`,
        });
      }
    } catch (error) {
      setFiles((prev) =>
        prev.map((entry) =>
          entry.id === file.id
            ? {
                ...entry,
                status: "error",
                error: error instanceof Error ? error.message : "Resume failed",
              }
            : entry
        )
      );
      toast({
        title: "Resume failed",
        description: error instanceof Error ? error.message : "Unable to resume OCR",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const signOut = async () => {
    try {
      const response = await fetch("/api/auth/signout", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Sign out failed (${response.status})`);
      }

      router.replace("/auth");
    } catch (error) {
      toast({
        title: "Sign out failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
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
              <p className="text-xs text-muted-foreground -mt-0.5">AI Document OCR</p>
            </div>
          </motion.div>

          <div className="flex items-center gap-3">
            {/* Model Selector */}
            <Select
              value={selectedModel}
              onValueChange={setSelectedModel}
              disabled={isLoadingModels || models.length === 0}
            >
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder={isLoadingModels ? "Loading models..." : "Select model"} />
              </SelectTrigger>
              <SelectContent>
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={openHistoryModal}
            >
              <History className="h-4 w-4 mr-1.5" />
              Past OCR
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setApiSettingsDraft(apiSettings);
                setApiSettingsOpen(true);
              }}
            >
              <Settings2 className="h-4 w-4 mr-1.5" />
              API Settings
            </Button>

            {modelError ? <p className="text-xs text-destructive max-w-[180px] truncate">{modelError}</p> : null}

            {/* Export All Button */}
            {completedCount > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <Button variant="outline" size="sm" onClick={exportAllAsZip}>
                  <FileArchive className="h-4 w-4 mr-1.5" />
                  Export ZIP
                </Button>
              </motion.div>
            )}

            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1.5" />
              Sign out
            </Button>

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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>API Endpoint Settings</DialogTitle>
            <DialogDescription>
              Configure model host and API key used for fetching available models.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
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
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="mistral">Mistral OCR API</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-endpoint">API endpoint</Label>
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
              <Label htmlFor="api-key">API key (optional)</Label>
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
              Cancel
            </Button>
            <Button onClick={saveApiSettings} disabled={isSavingApiSettings}>
              {isSavingApiSettings ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
              Save
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
        <DialogContent className="sm:max-w-5xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Past OCR Runs</DialogTitle>
            <DialogDescription>
              Browse previous OCR runs, inspect output, download, or delete saved runs.
            </DialogDescription>
          </DialogHeader>

          <div className="grid md:grid-cols-[300px_1fr] gap-4 flex-1 min-h-0">
            <Card className="min-h-0 flex flex-col">
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm">History</CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                {isLoadingHistory ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : historyJobs.length === 0 ? (
                  <div className="h-full flex items-center justify-center p-4 text-center">
                    <p className="text-sm text-muted-foreground">No OCR runs saved yet.</p>
                  </div>
                ) : (
                  <ScrollArea className="h-full">
                    <div className="p-2 space-y-1">
                      {historyJobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => setSelectedHistoryId(job.id)}
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
                              {job.status.toLowerCase()}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{job.model}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {formatTimestamp(job.createdAt)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="min-h-0 flex flex-col">
              <CardHeader className="py-3 px-4 border-b">
                <CardTitle className="text-sm">Run Details</CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 min-h-0">
                {isLoadingHistoryDetail ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !selectedHistoryJob ? (
                  <div className="h-full flex items-center justify-center p-4 text-center">
                    <p className="text-sm text-muted-foreground">Select a run to view details.</p>
                  </div>
                ) : (
                  <div className="h-full flex flex-col min-h-0">
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
                          {selectedHistoryJob.status.toLowerCase()}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">Model: {selectedHistoryJob.model}</p>
                      <p className="text-xs text-muted-foreground">
                        Created: {formatTimestamp(selectedHistoryJob.createdAt)}
                      </p>
                    </div>

                    <div className="grid md:grid-cols-[220px_1fr] flex-1 min-h-0">
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
                            <p className="text-xs">No preview saved</p>
                          </div>
                        )}
                      </div>
                      <Tabs defaultValue="markdown" className="flex-1 flex flex-col min-h-0">
                        <div className="px-3 pt-2 border-b">
                          <TabsList className="h-8">
                            <TabsTrigger value="markdown" className="text-xs h-6">Markdown</TabsTrigger>
                            <TabsTrigger value="markdown-raw" className="text-xs h-6">Markdown raw</TabsTrigger>
                            <TabsTrigger value="json" className="text-xs h-6">JSON</TabsTrigger>
                          </TabsList>
                        </div>
                        <TabsContent value="markdown" className="flex-1 m-0 min-h-0">
                          <ScrollArea className="h-full">
                            <div className="prose prose-sm dark:prose-invert max-w-none p-4">
                              <ReactMarkdown>{selectedHistoryMarkdown}</ReactMarkdown>
                            </div>
                          </ScrollArea>
                        </TabsContent>
                        <TabsContent value="markdown-raw" className="flex-1 m-0 min-h-0">
                          <ScrollArea className="h-full">
                            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                              {selectedHistoryMarkdown}
                            </pre>
                          </ScrollArea>
                        </TabsContent>
                        <TabsContent value="json" className="flex-1 m-0 min-h-0">
                          <ScrollArea className="h-full">
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
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download MD
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadHistoryResult("json")}
              disabled={!selectedHistoryJob}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download JSON
            </Button>
            <Button
              variant="destructive"
              onClick={deleteHistoryJob}
              disabled={!selectedHistoryId || isDeletingHistory}
            >
              {isDeletingHistory ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Delete Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-6">
        <div className="grid lg:grid-cols-[380px_1fr] gap-6 h-full">
          {/* Left Panel - File Upload & List */}
          <motion.div
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col gap-4"
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
                  {isDragOver ? "Drop files here" : "Drop documents or click to upload"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports images, PDFs, and documents
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
            <Card className="flex-1 min-h-0">
              <CardContent className="p-0 flex flex-col h-full">
                {/* File List Header */}
                <div className="flex items-center justify-between p-3 border-b">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {files.length} file{files.length !== 1 ? "s" : ""}
                    </span>
                    {completedCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {completedCount} done
                      </Badge>
                    )}
                    {errorCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {errorCount} failed
                      </Badge>
                    )}
                  </div>
                  {files.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground hover:text-destructive"
                      onClick={clearAllFiles}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Clear
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
                                    {file.pageCount} page{file.pageCount === 1 ? "" : "s"}
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
                                    <span className="text-xs text-amber-600">paused</span>
                                  </div>
                                ) : null}
                              </div>
                              {(file.status === "processing" || file.status === "paused") && (
                                <>
                                  <Progress value={file.progress} className="h-1 mt-1" />
                                  <div className="flex items-center justify-between mt-1">
                                    <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
                                      {file.stageMessage || (file.status === "paused" ? "Paused" : "Working")}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground">
                                      ETA {formatEta(file.etaSeconds)}
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
                      <p className="text-sm font-medium">No files yet</p>
                      <p className="text-xs text-muted-foreground">
                        Upload documents to start
                      </p>
                    </div>
                  </div>
                )}

                {/* Process Button */}
                <div className="p-3 border-t space-y-2">
                  <Button
                    className="w-full"
                    onClick={processFiles}
                    disabled={
                      isProcessing ||
                      pendingCount === 0 ||
                      !isPostProcessingReady ||
                      activeProcessingFile !== null
                    }
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 mr-2" />
                        Run OCR ({pendingCount} pending)
                      </>
                    )}
                  </Button>
                  {activeProcessingFile ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => stopProcessingFile(activeProcessingFile)}
                    >
                      <PauseCircle className="h-4 w-4 mr-2" />
                      Stop Current OCR
                    </Button>
                  ) : null}
                  {resumableSelectedFile ? (
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() => resumeProcessingFile(resumableSelectedFile)}
                    >
                      <PlayCircle className="h-4 w-4 mr-2" />
                      Resume From Checkpoint
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
                        <Settings2 className="h-4 w-4" />
                        Advanced Settings
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
                    {/* Language Selection */}
                    <div className="space-y-2">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Languages className="h-3 w-3" />
                        Document Language
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
                              {lang.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Toggle Settings */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Table Detection</Label>
                        <Switch
                          checked={settings.tableDetection}
                          onCheckedChange={(v) => setSettings((s) => ({ ...s, tableDetection: v }))}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Handwriting Recognition</Label>
                        <Switch
                          checked={settings.handwritingRecognition}
                          onCheckedChange={(v) => setSettings((s) => ({ ...s, handwritingRecognition: v }))}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Preserve Formatting</Label>
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
                        <Label className="text-xs">Output Quality</Label>
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
                      <Label className="text-xs">Custom Instructions</Label>
                      <Textarea
                        placeholder="Add custom OCR instructions..."
                        value={settings.customPrompt}
                        onChange={(e) => setSettings((s) => ({ ...s, customPrompt: e.target.value }))}
                        className="h-16 text-xs resize-none"
                      />
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label className="text-xs">Post-processing</Label>
                          <p className="text-[11px] text-muted-foreground">
                            Apply an extra model step after OCR extraction.
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
                            <Label className="text-xs">Instruction</Label>
                            <Textarea
                              placeholder="Example: Extract invoice number, due date, and totals from each page, then return one normalized table."
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
                            <Label className="text-xs">Post-processing model</Label>
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
                                  Same as OCR model ({selectedModel})
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
                            <Label className="text-xs">Output format</Label>
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
                                  Structured JSON
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ) : null}
                    </div>
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
                          Completed
                        </Badge>
                      )}
                      {selectedFile.status === "paused" && (
                        <Badge variant="outline" className="text-xs">
                          <PauseCircle className="h-3 w-3 mr-1 text-amber-500" />
                          Paused
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
                            className="h-7 px-2"
                            onClick={() => setViewMode("preview")}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant={viewMode === "split" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => setViewMode("split")}
                          >
                            <Columns className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant={viewMode === "result" ? "secondary" : "ghost"}
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => setViewMode("result")}
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                          <Separator orientation="vertical" className="h-5 mx-1" />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            onClick={() => copyToClipboard("md")}
                          >
                            {copied === "md" ? (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            onClick={() => downloadResult("md")}
                          >
                            <Download className="h-3.5 w-3.5" />
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
                            viewMode === "split" ? "w-1/2 border-r" : "flex-1"
                          )}
                        >
                          <div className="px-3 py-2 border-b bg-muted/30">
                            <span className="text-xs font-medium text-muted-foreground">Document Preview</span>
                          </div>
                          <ScrollArea className="flex-1">
                            <div className="p-4 flex items-center justify-center min-h-full">
                              {selectedFile.preview ? (
                                <motion.img
                                  initial={{ opacity: 0, scale: 0.95 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  src={selectedFile.preview}
                                  alt={selectedFile.name}
                                  className="max-w-full max-h-[500px] object-contain rounded-md shadow-sm"
                                />
                              ) : (
                                <div className="flex flex-col items-center text-muted-foreground">
                                  <ImageOff className="h-12 w-12 mb-2" />
                                  <p className="text-sm">No preview available</p>
                                  <p className="text-xs">Preview could not be generated</p>
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
                            viewMode === "split" ? "w-1/2" : "flex-1"
                          )}
                        >
                          <Tabs defaultValue="markdown" className="flex-1 flex flex-col min-h-0">
                            <div className="px-3 pt-2 border-b">
                              <TabsList className="h-8">
                                <TabsTrigger value="markdown" className="text-xs gap-1.5 h-6">
                                  <FileText className="h-3 w-3" />
                                  Markdown
                                </TabsTrigger>
                                <TabsTrigger value="markdown-raw" className="text-xs gap-1.5 h-6">
                                  <FileText className="h-3 w-3" />
                                  Markdown raw
                                </TabsTrigger>
                                <TabsTrigger value="json" className="text-xs gap-1.5 h-6">
                                  <Code className="h-3 w-3" />
                                  JSON
                                </TabsTrigger>
                              </TabsList>
                            </div>

                            <TabsContent value="markdown" className="flex-1 m-0 min-h-0">
                              <ScrollArea className="h-full">
                                <div className="prose prose-sm dark:prose-invert max-w-none p-4">
                                  <ReactMarkdown>{selectedFileMarkdown}</ReactMarkdown>
                                </div>
                              </ScrollArea>
                            </TabsContent>

                            <TabsContent value="markdown-raw" className="flex-1 m-0 min-h-0">
                              <ScrollArea className="h-full">
                                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                  {selectedFileMarkdown}
                                </pre>
                              </ScrollArea>
                            </TabsContent>

                            <TabsContent value="json" className="flex-1 m-0 min-h-0">
                              <ScrollArea className="h-full">
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
                              {selectedFile.status === "paused" ? "OCR Paused" : "Processing OCR"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {selectedFile.stageMessage || "Running extraction pipeline"}
                            </p>
                          </div>
                          <Badge variant={selectedFile.status === "paused" ? "outline" : "secondary"}>
                            {selectedFile.status === "paused" ? "paused" : "running"}
                          </Badge>
                        </div>
                        <Progress value={selectedFile.progress} className="w-full" />
                        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <ListChecks className="h-3.5 w-3.5" />
                            <span>
                              {selectedFile.processedPages || 0}/{selectedFile.pageCount || 0} pages
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Clock3 className="h-3.5 w-3.5" />
                            <span>ETA {formatEta(selectedFile.etaSeconds)}</span>
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
                                    alt={`${selectedFile.name} page ${pageNumber}`}
                                    className="w-full h-24 object-cover rounded"
                                  />
                                  <div className="flex items-center justify-between">
                                    <p className="text-[11px] font-medium">Page {pageNumber}</p>
                                    <Badge variant={processed ? "secondary" : "outline"} className="text-[10px]">
                                      {processed ? "done" : "queued"}
                                    </Badge>
                                  </div>
                                  <p className="text-[10px] text-muted-foreground line-clamp-3">
                                    {checkpoint?.previewText || "Waiting for extraction..."}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                        <ScrollArea className="h-full">
                          <div className="p-4 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              Live model activity
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
                                Waiting for progress events...
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
                        <p className="text-sm font-medium mb-1">Processing Failed</p>
                        <p className="text-xs text-muted-foreground max-w-xs">
                          {selectedFile.error || "An error occurred during OCR processing"}
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
                          <p className="text-sm font-medium mb-1">Ready for OCR</p>
                          <p className="text-xs text-muted-foreground">
                            Click "Run OCR" to extract text from this document
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
                          <p className="text-sm font-medium mb-1">Ready for OCR</p>
                          <p className="text-xs text-muted-foreground">
                            Click "Run OCR" to extract text
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
                    <h3 className="text-lg font-semibold mb-2">Select a document</h3>
                    <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                      Upload files and select one to view the OCR extraction results
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
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Estracto. AI-powered document OCR.
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Powered by VLM
            </span>
          </div>
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
