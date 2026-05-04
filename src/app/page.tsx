"use client";

import * as React from"react";
import { motion } from "motion/react";
import {
 Code,
 AlertCircle,
 ScanLine,
 ImageOff,
 KeyRoundIcon,
 Cloud,
 Layers,
 BellRing,
} from"lucide-react";

import { ArchiveIcon } from"@/components/ui/archive";
import { ArrowRightIcon } from"@/components/ui/arrow-right";
import { ChevronDownIcon } from"@/components/ui/chevron-down";
import { ClipboardCheckIcon } from"@/components/ui/clipboard-check";
import { ClockIcon } from"@/components/ui/clock";
import { DatabaseBackupIcon } from"@/components/ui/database-backup";
import { FileTextIcon } from"@/components/ui/file-text";
import { HistoryIcon } from"@/components/ui/history";
import { LanguagesIcon } from"@/components/ui/languages";
import { LoaderCircleIcon } from"@/components/ui/loader-circle";
import { PauseIcon } from"@/components/ui/pause";
import { PlayIcon } from"@/components/ui/play";
import { SettingsIcon } from"@/components/ui/settings";
import { SparklesIcon } from"@/components/ui/sparkles";
import { ZapIcon } from"@/components/ui/zap";
import { useRouter } from"next/navigation";

import { cn } from"@/lib/utils";
import { Button } from"@/components/ui/button";
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from"@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from"@/components/ui/tabs";
import { Progress } from"@/components/ui/progress";
import { Card, CardContent } from"@/components/ui/card";
import { ScrollArea } from"@/components/ui/scroll-area";
import { Badge } from"@/components/ui/badge";
import { Switch } from"@/components/ui/switch";
import { Label } from"@/components/ui/label";
import { Input } from"@/components/ui/input";
import { Textarea } from"@/components/ui/textarea";
import { Slider } from"@/components/ui/slider";
import {
 Collapsible,
 CollapsibleContent,
 CollapsibleTrigger,
} from"@/components/ui/collapsible";
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from"@/components/ui/dialog";
import {
 Tooltip,
 TooltipContent,
 TooltipTrigger,
} from"@/components/ui/tooltip";
import { Combobox } from"@/components/ui/combobox";
import { useToast } from"@/hooks/use-toast";
import { ToastAction } from"@/components/ui/toast";
import { normalizeProvider, type ProviderKind, type ClientApiSettings } from"@/lib/api-types";
import { type AdvancedSettings, type PostProcessingSettings, type PostProcessOutputFormat } from"@/lib/ocr/settings";
import {
  collectDroppedFiles,
  formatEta,
  formatTimestamp,
  getMarkdownFromJsonPayload,
  getStructuredJsonPayload,
  sleep,
  translatePipelineMessage,
} from "@/app/page-components/page-utils";
import {
  HintInfo,
  SettingsSection,
} from "@/app/page-components/settings-primitives";
import { FileListCard } from "@/app/page-components/file-list-card";
import { Footer } from "@/app/page-components/footer";
import { HeaderBar } from "@/app/page-components/header-bar";
import { ChangePasswordDialog } from "@/app/page-components/change-password-dialog";
import { ApiKeysSection } from "@/app/page-components/api-keys-section";
import { S3SettingsSection } from "@/app/page-components/s3-settings-section";
import { NotificationsSection } from "@/app/page-components/notifications-section";
import { UsageSection } from "@/app/page-components/usage-section";
import { WatchersSection } from "@/app/page-components/watchers-section";
import { TemplatesSection } from "@/app/page-components/templates-section";
import { clearQueue, deletePagePreviews, loadAllPagePreviews, loadQueue, persistPagePreviews, persistQueue, reconcileJobFromServer } from "@/app/page-components/queue-persistence";
import { HistoryDialog } from "@/app/page-components/history-dialog";
import { useHistory } from "@/app/page-components/use-history";
import { PreviewHeader } from "@/app/page-components/preview-header";
import { NoSelectionCard } from "@/app/page-components/no-selection-card";
import { DocumentGallery } from "@/app/page-components/document-gallery";
import { UploadArea } from "@/app/page-components/upload-area";
import type {
  OcrPageCheckpointView,
  OcrProgressEventView,
  ProcessingFile,
  SettingsTab,
  UiLanguage,
  KbExportPhase,
} from "@/app/page-components/types";
import ReactMarkdown from"react-markdown";
import remarkGfm from"remark-gfm";

// Types

type KbEmbeddingProvider ="ollama"|"openrouter"|"openai_compat";
type KbChunkingStrategy ="fixed"|"sentence"|"paragraph"|"hierarchical"|"semantic";
type KbStoreKind ="chroma"|"qdrant"|"weaviate"|"milvus"|"opensearch"|"pinecone"|"typesense";

const STORE_DEFAULT_BASE_URLS: Record<KbStoreKind, string> = {
 chroma:"http://127.0.0.1:8000",
 qdrant:"http://127.0.0.1:6333",
 weaviate:"http://127.0.0.1:8080",
 milvus:"http://127.0.0.1:9091",
 opensearch:"http://127.0.0.1:9200",
 pinecone:"",
 typesense:"http://127.0.0.1:8108",
};

const STORE_LABELS: Record<KbStoreKind, string> = {
 chroma:"Chroma",
 qdrant:"Qdrant",
 weaviate:"Weaviate",
 milvus:"Milvus",
 opensearch:"OpenSearch",
 pinecone:"Pinecone",
 typesense:"Typesense",
};

interface KbDefaultsForm {
 embeddingProvider: KbEmbeddingProvider;
 embeddingEndpoint: string;
 embeddingApiKey: string;
 embeddingHasApiKey: boolean;
 embeddingModel: string;
 embeddingDimensions: string;
 chunkingStrategy: KbChunkingStrategy;
 chunkingMaxSize: string;
 chunkingOverlap: string;
 chunkingMinSize: string;
 chunkingBreakpointPercentile: string;
 chunkingMaxHeadingDepth: string;
 storeKind: KbStoreKind;
 storeBaseUrl: string;
 storeApiKey: string;
 storeHasApiKey: boolean;
 storeDimensions: string;
 collectionTemplate: string;
 embeddingConcurrency: string;
}

const DEFAULT_KB_FORM: KbDefaultsForm = {
 embeddingProvider:"ollama",
 embeddingEndpoint:"http://127.0.0.1:11434",
 embeddingApiKey:"",
 embeddingHasApiKey: false,
 embeddingModel:"nomic-embed-text",
 embeddingDimensions:"768",
 chunkingStrategy:"paragraph",
 chunkingMaxSize:"1200",
 chunkingOverlap:"100",
 chunkingMinSize:"200",
 chunkingBreakpointPercentile:"95",
 chunkingMaxHeadingDepth:"6",
 storeKind:"chroma",
 storeBaseUrl:"http://127.0.0.1:8000",
 storeApiKey:"",
 storeHasApiKey: false,
 storeDimensions:"768",
 collectionTemplate:"extracto-{jobId}",
 embeddingConcurrency:"1",
};


interface Model {
 id: string;
 name: string;
 provider: string;
}

// Server-side ClientApiSettings deliberately omits apiKey. The UI form
// state still needs an apiKey field for the password input — modeled as a
// local-only extension so the network shape and the form shape don't drift.
type ApiSettingsForm = ClientApiSettings & { apiKey: string };


type ProviderModelSelections = Partial<Record<ProviderKind, string>>;

const UI_LANGUAGES: UiLanguage[] = ["it","en","fr","es","de"];

const UI_LANGUAGE_FLAGS: Record<UiLanguage, string> = {
 it:"🇮🇹",
 en:"🇬🇧",
 fr:"🇫🇷",
 es:"🇪🇸",
 de:"🇩🇪",
};

const UI_LANGUAGE_LABELS: Record<UiLanguage, string> = {
 it:"IT",
 en:"EN",
 fr:"FR",
 es:"ES",
 de:"DE",
};

function isUiLanguage(value: unknown): value is UiLanguage {
 return typeof value ==="string"&& (UI_LANGUAGES as string[]).includes(value);
}

const DEFAULT_OLLAMA_ENDPOINT ="http://localhost:11434";
const DEFAULT_MISTRAL_ENDPOINT ="https://api.mistral.ai/v1/ocr";
const DEFAULT_OPENROUTER_ENDPOINT ="https://openrouter.ai/api/v1";
const DEFAULT_OPENAI_COMPAT_ENDPOINT ="https://api.openai.com/v1";
const MODEL_SELECTIONS_STORAGE_KEY ="extracto:model-selections:v1";
const POST_PROCESS_MODEL_SELECTIONS_STORAGE_KEY =
"extracto:post-process-model-selections:v1";
const UI_LANGUAGE_STORAGE_KEY ="extracto:ui-language:v1";



function defaultEndpointForProvider(provider: ProviderKind): string {
 if (provider ==="mistral") return DEFAULT_MISTRAL_ENDPOINT;
 if (provider ==="openrouter") return DEFAULT_OPENROUTER_ENDPOINT;
 if (provider ==="openai_compat") return DEFAULT_OPENAI_COMPAT_ENDPOINT;
 return DEFAULT_OLLAMA_ENDPOINT;
}

function isMistralOcrModelId(modelId: string): boolean {
 return modelId.trim().toLowerCase().includes("ocr");
}

function pickPreferredProviderModelId(
 provider: ProviderKind,
 modelIds: string[]
): string {
 if (provider ==="mistral") {
 return modelIds.find((id) => isMistralOcrModelId(id)) || modelIds[0] ||"";
 }

 return modelIds[0] ||"";
}

const DEFAULT_API_SETTINGS: ApiSettingsForm = {
 provider:"ollama",
 apiEndpoint: DEFAULT_OLLAMA_ENDPOINT,
 apiKey:"",
 hasApiKey: false,
};

const OLLAMA_FALLBACK_MODELS: Model[] = [
 { id:"llama3.2-vision:latest", name:"Llama 3.2 Vision", provider:"ollama"},
 { id:"llava:latest", name:"LLaVA", provider:"ollama"},
 { id:"minicpm-v:latest", name:"MiniCPM-V", provider:"ollama"},
];
const MISTRAL_FALLBACK_MODELS: Model[] = [
 { id:"mistral-ocr-latest", name:"mistral-ocr-latest", provider:"mistral"},
 { id:"mistral-ocr", name:"mistral-ocr", provider:"mistral"},
 { id:"pixtral-12b", name:"pixtral-12b", provider:"mistral"},
];
const OPENROUTER_FALLBACK_MODELS_UI: Model[] = [
 { id:"anthropic/claude-3.5-sonnet", name:"anthropic/claude-3.5-sonnet", provider:"openrouter"},
 { id:"openai/gpt-4o", name:"openai/gpt-4o", provider:"openrouter"},
 { id:"openai/gpt-4o-mini", name:"openai/gpt-4o-mini", provider:"openrouter"},
 { id:"google/gemini-2.0-flash-001", name:"google/gemini-2.0-flash-001", provider:"openrouter"},
 { id:"qwen/qwen-2-vl-72b-instruct", name:"qwen/qwen-2-vl-72b-instruct", provider:"openrouter"},
];
const OPENAI_COMPAT_FALLBACK_MODELS: Model[] = [
 { id:"gpt-4o", name:"gpt-4o", provider:"openai_compat"},
 { id:"gpt-4o-mini", name:"gpt-4o-mini", provider:"openai_compat"},
];

function getFallbackModelsForProvider(provider: ProviderKind): Model[] {
 switch (provider) {
 case"ollama": return OLLAMA_FALLBACK_MODELS;
 case"mistral": return MISTRAL_FALLBACK_MODELS;
 case"openrouter": return OPENROUTER_FALLBACK_MODELS_UI;
 case"openai_compat": return OPENAI_COMPAT_FALLBACK_MODELS;
 default: return [];
 }
}

// Languages (OCR-detectable; not the UI language)
interface OcrLanguageEntry {
 code: string;
 names: Record<UiLanguage, string>;
}
const LANGUAGES: OcrLanguageEntry[] = [
 { code:"auto", names: { it:"Rilevamento automatico", en:"Auto Detect", fr:"Détection auto", es:"Detección auto", de:"Automatisch"} },
 { code:"en", names: { it:"Inglese", en:"English", fr:"Anglais", es:"Inglés", de:"Englisch"} },
 { code:"es", names: { it:"Spagnolo", en:"Spanish", fr:"Espagnol", es:"Español", de:"Spanisch"} },
 { code:"fr", names: { it:"Francese", en:"French", fr:"Français", es:"Francés", de:"Französisch"} },
 { code:"de", names: { it:"Tedesco", en:"German", fr:"Allemand", es:"Alemán", de:"Deutsch"} },
 { code:"zh", names: { it:"Cinese", en:"Chinese", fr:"Chinois", es:"Chino", de:"Chinesisch"} },
 { code:"ja", names: { it:"Giapponese", en:"Japanese", fr:"Japonais", es:"Japonés", de:"Japanisch"} },
 { code:"ko", names: { it:"Coreano", en:"Korean", fr:"Coréen", es:"Coreano", de:"Koreanisch"} },
 { code:"pt", names: { it:"Portoghese", en:"Portuguese", fr:"Portugais", es:"Portugués", de:"Portugiesisch"} },
 { code:"it", names: { it:"Italiano", en:"Italian", fr:"Italien", es:"Italiano", de:"Italienisch"} },
];

function readProviderModelSelections(storageKey: string): ProviderModelSelections {
 if (typeof window ==="undefined") {
 return {};
 }

 try {
 const rawValue = window.localStorage.getItem(storageKey);
 if (!rawValue) {
 return {};
 }

 const parsed = JSON.parse(rawValue) as unknown;
 if (!parsed || typeof parsed !=="object"|| Array.isArray(parsed)) {
 return {};
 }

 const typed = parsed as Record<string, unknown>;
 return {
 ollama: typeof typed.ollama ==="string"? typed.ollama.trim() :"",
 mistral: typeof typed.mistral ==="string"? typed.mistral.trim() :"",
 openrouter: typeof typed.openrouter ==="string"? typed.openrouter.trim() :"",
 openai_compat: typeof typed.openai_compat ==="string"? typed.openai_compat.trim() :"",
 };
 } catch {
 return {};
 }
}

function writeProviderModelSelections(
 storageKey: string,
 selections: ProviderModelSelections
): void {
 if (typeof window ==="undefined") {
 return;
 }

 try {
 window.localStorage.setItem(
 storageKey,
 JSON.stringify({
 ollama: selections.ollama ||"",
 mistral: selections.mistral ||"",
 openrouter: selections.openrouter ||"",
 openai_compat: selections.openai_compat ||"",
 })
 );
 } catch {
 // ignore storage errors
 }
}


// Utility functions

const PDF_RENDER_SCALE = 1.5;
const PDF_MAX_DIMENSION = 1600;
const PDFJS_MODULE_URL ="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER_URL ="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

let pdfJsLibPromise: Promise<Record<string, unknown>> | null = null;
const pdfBytesCache = new WeakMap<File, Promise<Uint8Array>>();

function isPdfFile(file: File): boolean {
 return file.type ==="application/pdf"|| file.name.toLowerCase().endsWith(".pdf");
}

function readImageAsDataUrl(file: File): Promise<string> {
 return new Promise((resolve) => {
 const reader = new FileReader();
 reader.onload = (event) => resolve((event.target?.result as string) ||"");
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

async function getPdfArrayBuffer(file: File): Promise<ArrayBuffer> {
 const cached = pdfBytesCache.get(file);
 if (cached) {
 const bytes = await cached;
 return bytes.slice().buffer;
 }

 // Cache immutable bytes and always hand pdf.js a fresh ArrayBuffer copy.
 const next = file.arrayBuffer().then((buffer) => Uint8Array.from(new Uint8Array(buffer)));
 pdfBytesCache.set(file, next);
 const bytes = await next;
 return bytes.slice().buffer;
}

async function renderPdfPagesAsImages(
 file: File,
 options?: { pageLimit?: number; startPage?: number }
): Promise<string[]> {
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

 const loadingTask = getDocument({ data: await getPdfArrayBuffer(file) });
 const pdfDocument = await loadingTask.promise;
 const startPage =
 typeof options?.startPage ==="number"&& Number.isFinite(options.startPage) && options.startPage > 0
 ? Math.floor(options.startPage)
 : 1;
 const normalizedLimit =
 typeof options?.pageLimit ==="number"&& Number.isFinite(options.pageLimit) && options.pageLimit > 0
 ? Math.floor(options.pageLimit)
 : pdfDocument.numPages;
 const lastPage = Math.min(pdfDocument.numPages, startPage + normalizedLimit - 1);
 const pageImages: string[] = [];

 for (let pageNumber = startPage; pageNumber <= lastPage; pageNumber++) {
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

 const loadingTask = getDocument({ data: await getPdfArrayBuffer(file) });
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
 return { preview:"", pageCount: 1 };
 }

 try {
 const pageCount = await getPdfPageCount(file).catch(() => undefined);
 const previews = await renderPdfPagesAsImages(file, { pageLimit: 1, startPage: 1 });
 const firstPage = previews[0] ||"";
 return { preview: firstPage, pagePreviews: previews, pageCount };
 } catch {
 return { preview:""};
 }
}

// Main Component
export default function ExtractoPage() {
 const router = useRouter();
 const { toast } = useToast();
 const [files, setFiles] = React.useState<ProcessingFile[]>([]);
 const [bulkSelectedIds, setBulkSelectedIds] = React.useState<Set<string>>(() => new Set());
 const [selectedModel, setSelectedModel] = React.useState<string>(OLLAMA_FALLBACK_MODELS[0].id);
 const [models, setModels] = React.useState<Model[]>(OLLAMA_FALLBACK_MODELS);
 const [apiSettings, setApiSettings] = React.useState<ApiSettingsForm>(DEFAULT_API_SETTINGS);
 const [apiSettingsDraft, setApiSettingsDraft] = React.useState<ApiSettingsForm>(DEFAULT_API_SETTINGS);
 const [apiKeyDirty, setApiKeyDirty] = React.useState(false);
 const [isDragOver, setIsDragOver] = React.useState(false);
 const [isProcessing, setIsProcessing] = React.useState(false);
 const [uiLanguage, setUiLanguage] = React.useState<UiLanguage>("en");
 const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
 const [copied, setCopied] = React.useState<"md"|"json"| null>(null);
 const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);
 const [settingsTab, setSettingsTab] = React.useState<SettingsTab>("model");
 const [viewMode, setViewMode] = React.useState<"preview"|"split"|"result">("split");
 const pdfPagePreviewCacheRef = React.useRef<Record<string, string[]>>({});
 const persistQuotaWarnedRef = React.useRef(false);
 const modelSelectionsRef = React.useRef<ProviderModelSelections>({});
 const postProcessModelSelectionsRef = React.useRef<ProviderModelSelections>({});
 const modelSelectionsHydratedRef = React.useRef(false);
 const [isLoadingModels, setIsLoadingModels] = React.useState(false);
 const [isSavingApiSettings, setIsSavingApiSettings] = React.useState(false);
 const [isSigningOut, setIsSigningOut] = React.useState(false);
 const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);
 const [modelError, setModelError] = React.useState("");
 const [historyOpen, setHistoryOpen] = React.useState(false);

 // Advanced settings state
 const ocrSettingsLoadedRef = React.useRef(false);
 const [settings, setSettings] = React.useState<AdvancedSettings>({
 language:"auto",
 tableDetection: true,
 handwritingRecognition: false,
 preserveFormatting: true,
 customPrompt:"",
 quality: 80,
 preferTextLayer: true,
 documentPreset: "generic",
 pageConcurrency: 0,
 autoRetryMaxAttempts: 1,
 });
 const [postProcessing, setPostProcessing] = React.useState<PostProcessingSettings>({
 enabled: false,
 instruction:"",
 outputFormat:"markdown",
 model:"",
 });

 // KB export defaults — loaded from /api/kb/defaults on mount, edited
 // via the Database header button, used when the user clicks "Send to
 // KB" on a completed file.
 const [kbDefaults, setKbDefaults] = React.useState<KbDefaultsForm>(DEFAULT_KB_FORM);
 const [kbDefaultsDraft, setKbDefaultsDraft] = React.useState<KbDefaultsForm>(DEFAULT_KB_FORM);
 const [, setKbDefaultsOpen] = React.useState(false);
 const [kbEmbeddingKeyDirty, setKbEmbeddingKeyDirty] = React.useState(false);
 const [kbStoreKeyDirty, setKbStoreKeyDirty] = React.useState(false);
 const [isSavingKbDefaults, setIsSavingKbDefaults] = React.useState(false);
 const [isTestingStore, setIsTestingStore] = React.useState(false);
 const [storeTestResult, setStoreTestResult] = React.useState<{ ok: boolean; latencyMs: number; version?: string; endpoint?: string; error?: string } | null>(null);
 const [allPagePreviews, setAllPagePreviews] = React.useState<string[]>([]);
 const [allPagePreviewsForFileId, setAllPagePreviewsForFileId] = React.useState<string | null>(null);
 const [isLoadingAllPagePreviews, setIsLoadingAllPagePreviews] = React.useState(false);
 const kbDefaultsLoadedRef = React.useRef(false);
 const [embeddingModelOptions, setEmbeddingModelOptions] = React.useState<{ value: string; label: string; hint?: string }[]>([]);
 const [embeddingModelsLoading, setEmbeddingModelsLoading] = React.useState(false);

 const fetchEmbeddingModels = React.useCallback(async () => {
 setEmbeddingModelsLoading(true);
 try {
 const resp = await fetch("/api/kb/embedding-models", {
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify({
 provider: kbDefaultsDraft.embeddingProvider,
 apiEndpoint: kbDefaultsDraft.embeddingEndpoint.trim() || undefined,
 ...(kbEmbeddingKeyDirty && kbDefaultsDraft.embeddingApiKey ? { apiKey: kbDefaultsDraft.embeddingApiKey } : {}),
 }),
 });
 if (!resp.ok) {
 const payload = await resp.json().catch(() => ({})) as { error?: string };
 throw new Error(payload.error || `Discovery failed (${resp.status})`);
 }
 const payload = await resp.json() as { embeddings: string[]; others: string[] };
 const opts: { value: string; label: string; hint?: string }[] = [
 ...payload.embeddings.map((id) => ({ value: id, label: id, hint:"embedding"})),
 ...payload.others.map((id) => ({ value: id, label: id })),
 ];
 setEmbeddingModelOptions(opts);
 } catch (error) {
 toast({
 title:"Model discovery failed",
 description: error instanceof Error ? error.message :"",
 variant:"destructive",
 });
 } finally {
 setEmbeddingModelsLoading(false);
 }
 }, [kbDefaultsDraft.embeddingProvider, kbDefaultsDraft.embeddingEndpoint, kbDefaultsDraft.embeddingApiKey, kbEmbeddingKeyDirty, toast]);

 const selectedFile = files.find((f) => f.id === selectedFileId);
 const selectedFileMarkdown = selectedFile?.result
 ? getMarkdownFromJsonPayload(selectedFile.result.json, selectedFile.result.text)
 :"";
 const selectedFileStructuredJson = selectedFile?.result
 ? getStructuredJsonPayload(selectedFile.result.json)
 : {};
 const completedCount = files.filter((f) => f.status ==="completed").length;
 const canExportZip = Boolean(completedCount > 0 || selectedFile?.status ==="completed");
 const errorCount = files.filter((f) => f.status ==="error").length;
 const pendingCount = files.filter((f) => f.status ==="pending").length;
 const activeProcessingFile = files.find((f) => f.status ==="processing") || null;
 const resumableSelectedFile = selectedFile?.status ==="paused"? selectedFile : null;
 const isPostProcessingReady =
 !postProcessing.enabled || postProcessing.instruction.trim().length > 0;
 const isRunReady = isPostProcessingReady;
 const postProcessModelValue = postProcessing.model ||"__same__";
 const selectedPostProcessModelExists = postProcessing.model
 ? models.some((model) => model.id === postProcessing.model)
 : true;
 const t = React.useCallback(
 (it: string, en: string, fr?: string, es?: string, de?: string) => {
 switch (uiLanguage) {
 case"it":
 return it;
 case"fr":
 return fr ?? en;
 case"es":
 return es ?? en;
 case"de":
 return de ?? en;
 default:
 return en;
 }
 },
 [uiLanguage]
 );
 const history = useHistory(t);
 const openSettingsTab = React.useCallback(
 (tab: SettingsTab) => {
 setApiSettingsDraft(apiSettings);
 setApiKeyDirty(false);
 setKbDefaultsDraft(kbDefaults);
 setKbEmbeddingKeyDirty(false);
 setKbStoreKeyDirty(false);
 setSettingsTab(tab);
 setApiSettingsOpen(true);
 },
 [apiSettings, kbDefaults],
 );
 const updateFileById = React.useCallback(
 (fileId: string, updater: (current: ProcessingFile) => ProcessingFile) => {
 setFiles((prev) => {
 const index = prev.findIndex((entry) => entry.id === fileId);
 if (index < 0) {
 return prev;
 }
 const current = prev[index];
 const next = updater(current);
 if (next === current) {
 return prev;
 }
 const clone = [...prev];
 clone[index] = next;
 return clone;
 });
 },
 []
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
 async (values: ApiSettingsForm) => {
 setIsLoadingModels(true);
 setModelError("");

 const normalizedSettings = {
 ...values,
 provider: normalizeProvider(values.provider),
 };

 try {
 const params = new URLSearchParams();
 params.set("provider", normalizedSettings.provider || DEFAULT_API_SETTINGS.provider);
 const response = await fetch(`/api/models?${params.toString()}`);

 if (!response.ok) {
 const payload = (await response.json().catch(() => ({}))) as { error?: string };
 throw new Error(payload.error || `Failed to load models (${response.status})`);
 }

 const payload = (await response.json()) as { models?: Model[] };
 const discoveredModels = Array.isArray(payload.models) ? payload.models : [];
 const fallbackModels = getFallbackModelsForProvider(
 normalizedSettings.provider
 );
 const nextModels = discoveredModels.length > 0 ? discoveredModels : fallbackModels;
 const providerModelIds = nextModels
 .filter((model) => normalizeProvider(model.provider) === normalizedSettings.provider)
 .map((model) => model.id);
 const storedModel =
 modelSelectionsRef.current[normalizedSettings.provider]?.trim() ||"";
 const providerFirstModelId =
 pickPreferredProviderModelId(
 normalizedSettings.provider as"ollama"|"mistral",
 providerModelIds
 ) || nextModels[0]?.id ||"";

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
 normalizedSettings.provider,
 nextValue
 );
 }
 return nextValue;
 });
 return nextModels;
 } catch (error) {
 const message = error instanceof Error ? error.message :"Unable to fetch models";
 setModelError(message);
 const fallbackModels = getFallbackModelsForProvider(
 normalizedSettings.provider
 );
 setModels(fallbackModels);
 const providerModelIds = fallbackModels
 .filter((model) => normalizeProvider(model.provider) === normalizedSettings.provider)
 .map((model) => model.id);
 const storedModel =
 modelSelectionsRef.current[normalizedSettings.provider]?.trim() ||"";
 const providerFirstModelId =
 pickPreferredProviderModelId(
 normalizedSettings.provider as"ollama"|"mistral",
 providerModelIds
 ) || fallbackModels[0]?.id ||"";
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
 normalizedSettings.provider,
 nextValue
 );
 }
 return nextValue;
 });
 toast({
 title: t("Recupero modelli non riuscito","Model fetch failed","Échec de récupération des modèles","Error al obtener modelos","Modelle laden fehlgeschlagen"),
 description: message,
 variant:"destructive",
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
 const [apiResp, ocrResp] = await Promise.all([
 fetch("/api/settings", { cache:"no-store" }),
 fetch("/api/ocr/settings", { cache:"no-store" }),
 ]);

 if (!apiResp.ok) {
 throw new Error(`Failed to load API settings (${apiResp.status})`);
 }

 const values = (await apiResp.json()) as ApiSettingsForm;
 const provider = normalizeProvider(values.provider);
 const normalizedSettings: ApiSettingsForm = {
 provider,
 apiEndpoint: values.apiEndpoint?.trim() || defaultEndpointForProvider(provider),
 apiKey:"",
 hasApiKey: values.hasApiKey === true,
 };
 setApiSettings(normalizedSettings);
 setApiSettingsDraft(normalizedSettings);
 setApiKeyDirty(false);
 await fetchAvailableModels(normalizedSettings);

 if (ocrResp.ok) {
 const ocrValues = (await ocrResp.json()) as Partial<AdvancedSettings>;
 setSettings((prev) => ({ ...prev, ...ocrValues }));
 }
 ocrSettingsLoadedRef.current = true;
 } catch (error) {
 ocrSettingsLoadedRef.current = true;
 setApiSettings(DEFAULT_API_SETTINGS);
 setApiSettingsDraft(DEFAULT_API_SETTINGS);
 setApiKeyDirty(false);
 await fetchAvailableModels(DEFAULT_API_SETTINGS);
 toast({
 title: t("Caricamento impostazioni non riuscito","Settings load failed","Échec du chargement des paramètres","Error al cargar configuración","Einstellungen laden fehlgeschlagen"),
 description:
 error instanceof Error
 ? error.message
 : t("Impossibile caricare le impostazioni API, uso i valori predefiniti","Unable to load API settings, using defaults","Impossible de charger les paramètres API, valeurs par défaut utilisées","No se pudieron cargar los ajustes API, usando valores por defecto","API-Einstellungen konnten nicht geladen werden, Standardwerte werden verwendet"),
 variant:"destructive",
 });
 }
 }, [fetchAvailableModels, toast]);

 const saveApiSettings = async () => {
 setIsSavingApiSettings(true);
 try {
 const response = await fetch("/api/settings", {
 method:"PUT",
 headers: {
"Content-Type":"application/json",
 },
 body: JSON.stringify({
 ...apiSettingsDraft,
 replaceApiKey: apiKeyDirty,
 }),
 });

 if (!response.ok) {
 const payload = (await response.json().catch(() => ({}))) as { error?: string };
 throw new Error(payload.error || `Failed to save API settings (${response.status})`);
 }

 const saved = (await response.json()) as ApiSettingsForm;
 const provider = normalizeProvider(saved.provider);
 const normalizedSettings: ApiSettingsForm = {
 provider,
 apiEndpoint: saved.apiEndpoint?.trim() || defaultEndpointForProvider(provider),
 apiKey:"",
 hasApiKey: saved.hasApiKey === true,
 };

 setApiSettings(normalizedSettings);
 setApiSettingsDraft(normalizedSettings);
 setApiKeyDirty(false);
 setApiSettingsOpen(false);
 await fetchAvailableModels(normalizedSettings);
 toast({
 title: t("Impostazioni salvate","Settings saved","Paramètres enregistrés","Configuración guardada","Einstellungen gespeichert"),
 description: t("Configurazione API aggiornata","API configuration has been updated","Configuration API mise à jour","Configuración API actualizada","API-Konfiguration aktualisiert"),
 });
 } catch (error) {
 toast({
 title: t("Salvataggio non riuscito","Save failed","Échec de l'enregistrement","Error al guardar","Speichern fehlgeschlagen"),
 description: error instanceof Error ? error.message : t("Impossibile salvare le impostazioni API","Unable to save API settings","Impossible d'enregistrer les paramètres API","No se pudieron guardar los ajustes API","API-Einstellungen konnten nicht gespeichert werden"),
 variant:"destructive",
 });
 } finally {
 setIsSavingApiSettings(false);
 }
 };

 const openHistoryModal = async () => {
 setHistoryOpen(true);
 await history.loadJobs();
 };

 const downloadHistoryResult = (type:"md"|"json") => {
 if (!history.selectedJob) return;
 const fileStem = history.selectedJob.fileName.replace(/\.[^/.]+$/,"") ||"ocr-result";
 const isMarkdown = type === "md";
 const blobBody = isMarkdown
 ? history.selectedMarkdown
 : JSON.stringify(history.selectedStructuredJson, null, 2);
 const blob = new Blob([blobBody], { type: isMarkdown ? "text/markdown" : "application/json" });
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `${fileStem}.${type}`;
 a.click();
 URL.revokeObjectURL(url);
 };

 const queueHydrated = React.useRef(false);
 const [hydrateComplete, setHydrateComplete] = React.useState(false);
 React.useEffect(() => {
 if (queueHydrated.current) return;
 queueHydrated.current = true;
 void (async () => {
 try {
 const [stored, pagesByFile] = await Promise.all([loadQueue(), loadAllPagePreviews()]);
 for (const [fileId, pages] of pagesByFile) {
 pdfPagePreviewCacheRef.current[fileId] = pages;
 }
 if (stored.length > 0) {
 setFiles(stored);
 const reconciled = await Promise.all(stored.map((f) => reconcileJobFromServer(f)));
 setFiles(reconciled);
 }
 } finally {
 setHydrateComplete(true);
 }
 })();
 }, []);

 React.useEffect(() => {
 if (!hydrateComplete) return;
 const t = setTimeout(() => { void persistQueue(files); }, 400);
 return () => clearTimeout(t);
 }, [files, hydrateComplete]);

 React.useEffect(() => {
 try {
 const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
 if (isUiLanguage(storedLanguage)) {
 setUiLanguage(storedLanguage);
 } else {
 const browserLang = (navigator.language || "en").slice(0, 2).toLowerCase();
 if (isUiLanguage(browserLang)) {
 setUiLanguage(browserLang);
 }
 }
 } catch {
 // ignore storage errors
 }

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
 void loadSavedSettings();
 }, [loadSavedSettings]);

 React.useEffect(() => {
 if (!hydrateComplete) return;
 const activeIds = new Set(files.map((file) => file.id));
 for (const fileId of Object.keys(pdfPagePreviewCacheRef.current)) {
 if (!activeIds.has(fileId)) {
 delete pdfPagePreviewCacheRef.current[fileId];
 void deletePagePreviews(fileId);
 }
 }
 }, [files, hydrateComplete]);

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
 postProcessModelSelectionsRef.current[provider]?.trim() ||"";
 const providerModelIds = models
 .filter((model) => normalizeProvider(model.provider) === provider)
 .map((model) => model.id);
 const nextModel = storedModel && providerModelIds.includes(storedModel) ? storedModel :"";
 setPostProcessing((prev) => (prev.model === nextModel ? prev : { ...prev, model: nextModel }));
 }, [apiSettings.provider, models]);

 React.useEffect(() => {
 if (!modelSelectionsHydratedRef.current) {
 return;
 }

 const provider = normalizeProvider(apiSettings.provider);
 if (!postProcessing.model) {
 persistProviderSelection(POST_PROCESS_MODEL_SELECTIONS_STORAGE_KEY, provider,"");
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
 if (!historyOpen) return;
 if (!history.selectedId) {
 history.resetSelection();
 return;
 }
 void history.loadDetail(history.selectedId);
 }, [historyOpen, history.selectedId, history.loadDetail, history.resetSelection]);

 React.useEffect(() => {
 if (!ocrSettingsLoadedRef.current) return;
 const t = setTimeout(() => {
 void fetch("/api/ocr/settings", {
 method:"PUT",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify(settings),
 }).catch(() => undefined);
 }, 1000);
 return () => clearTimeout(t);
 }, [settings]);

 // Load saved KB-export defaults once. Failure is silent — the form
 // simply stays on its built-in defaults; the user can still configure
 // and save fresh values. KB_EXPORT_ENABLED gating happens at the
 // /api/kb/export endpoint, not here, so the UI for *editing* defaults
 // is always reachable.
 React.useEffect(() => {
 if (kbDefaultsLoadedRef.current) return;
 kbDefaultsLoadedRef.current = true;
 void (async () => {
 try {
 const resp = await fetch("/api/kb/defaults", { cache:"no-store" });
 if (!resp.ok) return;
 const payload = await resp.json() as {
 embedding?: { provider?: KbEmbeddingProvider; apiEndpoint?: string; model?: string; dimensions?: number; hasApiKey?: boolean };
 chunking?: { strategy?: KbChunkingStrategy; maxChunkSize?: number; overlap?: number; minChunkSize?: number; breakpointPercentile?: number; maxHeadingDepth?: number };
 vectorStore?: { kind?: KbStoreKind; baseUrl?: string; dimensions?: number; hasApiKey?: boolean };
 collectionNameTemplate?: string;
 embeddingConcurrency?: number;
 };
 const next: KbDefaultsForm = {
 embeddingProvider: payload.embedding?.provider ?? DEFAULT_KB_FORM.embeddingProvider,
 embeddingEndpoint: payload.embedding?.apiEndpoint ?? DEFAULT_KB_FORM.embeddingEndpoint,
 embeddingApiKey:"",
 embeddingHasApiKey: payload.embedding?.hasApiKey === true,
 embeddingModel: payload.embedding?.model ?? DEFAULT_KB_FORM.embeddingModel,
 embeddingDimensions: String(payload.embedding?.dimensions ?? DEFAULT_KB_FORM.embeddingDimensions),
 chunkingStrategy: payload.chunking?.strategy ?? DEFAULT_KB_FORM.chunkingStrategy,
 chunkingMaxSize: String(payload.chunking?.maxChunkSize ?? DEFAULT_KB_FORM.chunkingMaxSize),
 chunkingOverlap: payload.chunking?.overlap != null ? String(payload.chunking.overlap) : DEFAULT_KB_FORM.chunkingOverlap,
 chunkingMinSize: payload.chunking?.minChunkSize != null ? String(payload.chunking.minChunkSize) : DEFAULT_KB_FORM.chunkingMinSize,
 chunkingBreakpointPercentile: payload.chunking?.breakpointPercentile != null ? String(payload.chunking.breakpointPercentile) : DEFAULT_KB_FORM.chunkingBreakpointPercentile,
 chunkingMaxHeadingDepth: payload.chunking?.maxHeadingDepth != null ? String(payload.chunking.maxHeadingDepth) : DEFAULT_KB_FORM.chunkingMaxHeadingDepth,
 storeKind: payload.vectorStore?.kind ?? DEFAULT_KB_FORM.storeKind,
 storeBaseUrl: payload.vectorStore?.baseUrl ?? DEFAULT_KB_FORM.storeBaseUrl,
 storeApiKey:"",
 storeHasApiKey: payload.vectorStore?.hasApiKey === true,
 storeDimensions: String(payload.vectorStore?.dimensions ?? DEFAULT_KB_FORM.storeDimensions),
 collectionTemplate: payload.collectionNameTemplate ?? DEFAULT_KB_FORM.collectionTemplate,
 embeddingConcurrency: String(payload.embeddingConcurrency ?? DEFAULT_KB_FORM.embeddingConcurrency),
 };
 setKbDefaults(next);
 setKbDefaultsDraft(next);
 } catch {
 // Silent — keep built-in defaults.
 }
 })();
 }, []);

 const saveKbDefaults = async () => {
 setIsSavingKbDefaults(true);
 try {
 const parseInt10 = (v: string): number | undefined => {
 const n = Number.parseInt(v, 10);
 return Number.isFinite(n) ? n : undefined;
 };
 const parseFloat10 = (v: string): number | undefined => {
 const n = Number.parseFloat(v);
 return Number.isFinite(n) ? n : undefined;
 };
 const body = {
 embedding: {
 provider: kbDefaultsDraft.embeddingProvider,
 apiEndpoint: kbDefaultsDraft.embeddingEndpoint.trim(),
 model: kbDefaultsDraft.embeddingModel.trim(),
 dimensions: parseInt10(kbDefaultsDraft.embeddingDimensions),
 ...(kbEmbeddingKeyDirty ? { apiKey: kbDefaultsDraft.embeddingApiKey, replaceApiKey: true } : {}),
 },
 chunking: {
 strategy: kbDefaultsDraft.chunkingStrategy,
 maxChunkSize: parseInt10(kbDefaultsDraft.chunkingMaxSize) ?? 1200,
 overlap: parseInt10(kbDefaultsDraft.chunkingOverlap),
 minChunkSize: parseInt10(kbDefaultsDraft.chunkingMinSize),
 breakpointPercentile: parseFloat10(kbDefaultsDraft.chunkingBreakpointPercentile),
 maxHeadingDepth: parseInt10(kbDefaultsDraft.chunkingMaxHeadingDepth),
 },
 vectorStore: {
 kind: kbDefaultsDraft.storeKind,
 baseUrl: kbDefaultsDraft.storeBaseUrl.trim(),
 dimensions: parseInt10(kbDefaultsDraft.storeDimensions),
 ...(kbStoreKeyDirty ? { apiKey: kbDefaultsDraft.storeApiKey, replaceApiKey: true } : {}),
 },
 collectionNameTemplate: kbDefaultsDraft.collectionTemplate.trim(),
 embeddingConcurrency: Math.max(1, Math.min(16, parseInt10(kbDefaultsDraft.embeddingConcurrency) ?? 1)),
 };
 const resp = await fetch("/api/kb/defaults", {
 method:"PUT",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify(body),
 });
 if (!resp.ok) {
 const payload = (await resp.json().catch(() => ({}))) as { error?: string };
 throw new Error(payload.error || `Save failed (${resp.status})`);
 }
 const saved = await resp.json() as {
 embedding: { hasApiKey?: boolean };
 vectorStore: { hasApiKey?: boolean };
 };
 const next: KbDefaultsForm = {
 ...kbDefaultsDraft,
 embeddingApiKey:"",
 embeddingHasApiKey: saved.embedding.hasApiKey === true,
 storeApiKey:"",
 storeHasApiKey: saved.vectorStore.hasApiKey === true,
 };
 setKbDefaults(next);
 setKbDefaultsDraft(next);
 setKbEmbeddingKeyDirty(false);
 setKbStoreKeyDirty(false);
 setKbDefaultsOpen(false);
 toast({
 title: t("Default KB salvati","KB defaults saved","Valeurs KB enregistrées","Valores KB guardados","KB-Standardwerte gespeichert"),
 });
 } catch (error) {
 toast({
 title: t("Salvataggio KB non riuscito","KB save failed","Échec d'enregistrement KB","Error al guardar KB","KB-Speicherung fehlgeschlagen"),
 description: error instanceof Error ? error.message :"",
 variant:"destructive",
 });
 } finally {
 setIsSavingKbDefaults(false);
 setStoreTestResult(null);
 }
 };

 const testStoreConnection = async () => {
 setIsTestingStore(true);
 setStoreTestResult(null);
 try {
 const baseUrl = kbDefaultsDraft.storeBaseUrl.trim() || STORE_DEFAULT_BASE_URLS[kbDefaultsDraft.storeKind];
 const requestBody: { kind: string; baseUrl: string; apiKey?: string } = {
 kind: kbDefaultsDraft.storeKind,
 baseUrl,
 };
 if (kbStoreKeyDirty) {
 requestBody.apiKey = kbDefaultsDraft.storeApiKey;
 }
 const resp = await fetch("/api/kb/test-connection", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(requestBody),
 });
 const payload = await resp.json().catch(() => ({})) as { ok?: boolean; latencyMs?: number; version?: string; endpoint?: string; error?: string };
 const failedTitle = t("Connessione fallita","Connection failed","Échec de la connexion","Conexión fallida","Verbindung fehlgeschlagen");
 const failContext = `${kbDefaultsDraft.storeKind} @ ${baseUrl}${payload.endpoint ? ` ${payload.endpoint}` : ""}`;
 if (!resp.ok && !payload?.ok) {
 const failMsg = payload.error || `HTTP ${resp.status}`;
 setStoreTestResult({ ok: false, latencyMs: payload.latencyMs ?? 0, error: failMsg });
 toast({
 title: failedTitle,
 description: `${failMsg} · ${failContext}`,
 variant: "destructive",
 });
 return;
 }
 setStoreTestResult({
 ok: payload.ok === true,
 latencyMs: payload.latencyMs ?? 0,
 version: payload.version,
 endpoint: payload.endpoint,
 error: payload.error,
 });
 if (payload.ok) {
 const description = payload.version
 ? `v${payload.version} · ${payload.latencyMs ?? 0}ms`
 : `${payload.latencyMs ?? 0}ms`;
 toast({
 title: t("Connessione riuscita","Connection successful","Connexion réussie","Conexión exitosa","Verbindung erfolgreich"),
 description,
 });
 } else {
 toast({
 title: failedTitle,
 description: `${payload.error || ""} · ${failContext}`,
 variant: "destructive",
 });
 }
 } catch (error) {
 const msg = error instanceof Error ? error.message : String(error);
 setStoreTestResult({ ok: false, latencyMs: 0, error: msg });
 toast({
 title: t("Connessione fallita","Connection failed","Échec de la connexion","Conexión fallida","Verbindung fehlgeschlagen"),
 description: msg,
 variant: "destructive",
 });
 } finally {
 setIsTestingStore(false);
 }
 };

 const exportFileToKb = async (file: ProcessingFile) => {
 if (!file.jobId) {
 toast({
 title: t("Nessun jobId","Missing jobId","jobId manquant","Falta jobId","jobId fehlt"),
 description: t(
"Solo i lavori OCR completati possono essere esportati.",
"Only completed OCR jobs can be exported.",
"Seuls les jobs OCR terminés peuvent être exportés.",
"Solo se pueden exportar trabajos OCR completados.",
"Nur abgeschlossene OCR-Jobs können exportiert werden.",
 ),
 variant:"destructive",
 });
 return;
 }
 updateFileById(file.id, (entry) => ({ ...entry, kbExport: { status:"pending", phase:"queued", embeddingDone: 0, embeddingTotal: 0 } }));
 try {
 const resp = await fetch("/api/kb/export", {
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify({ jobId: file.jobId }),
 });
 const payload = (await resp.json().catch(() => ({}))) as { error?: string; exportId?: string; collectionName?: string };
 if (!resp.ok || !payload.exportId) {
 throw new Error(payload.error || `Export failed (${resp.status})`);
 }
 const exportId = payload.exportId;
 const finalEvent = await new Promise<{ phase:"done"|"error"; chunkCount: number; collectionName: string; error?: string }>((resolve, reject) => {
 const es = new EventSource(`/api/kb/export/${encodeURIComponent(exportId)}/stream`);
 es.addEventListener("progress", (event) => {
 try {
 const data = JSON.parse((event as MessageEvent).data) as { phase: string; embeddingDone?: number; embeddingTotal?: number; chunkCount?: number; collectionName?: string; error?: string };
 updateFileById(file.id, (entry) => ({
 ...entry,
 kbExport: {
 status: data.phase === "done"?"success": data.phase === "error"?"error":"pending",
 phase: data.phase as KbExportPhase,
 embeddingDone: data.embeddingDone ?? 0,
 embeddingTotal: data.embeddingTotal ?? 0,
 chunkCount: data.chunkCount ?? entry.kbExport?.chunkCount ?? 0,
 collectionName: data.collectionName ?? entry.kbExport?.collectionName ?? payload.collectionName ??"",
 error: data.error,
 },
 }));
 if (data.phase === "done"|| data.phase === "error") {
 es.close();
 if (data.phase === "done") {
 resolve({ phase:"done", chunkCount: data.chunkCount ?? 0, collectionName: data.collectionName ?? payload.collectionName ??"" });
 } else {
 reject(new Error(data.error || "Export failed"));
 }
 }
 } catch (err) {
 es.close();
 reject(err);
 }
 });
 es.onerror = () => {
 es.close();
 reject(new Error("Lost connection to export progress stream"));
 };
 });
 updateFileById(file.id, (entry) => ({
 ...entry,
 kbExport: {
 status:"success",
 chunkCount: finalEvent.chunkCount,
 collectionName: finalEvent.collectionName,
 phase:"done",
 embeddingDone: finalEvent.chunkCount,
 embeddingTotal: finalEvent.chunkCount,
 },
 }));
 toast({
 title: t("Esportato nel KB","Exported to KB","Exporté vers KB","Exportado a KB","In KB exportiert"),
 description: finalEvent.collectionName
 ? t(
 `${finalEvent.chunkCount} chunk in ${finalEvent.collectionName}`,
 `${finalEvent.chunkCount} chunks in ${finalEvent.collectionName}`,
 )
 : undefined,
 });
 } catch (error) {
 const message = error instanceof Error ? error.message :"Unknown error";
 updateFileById(file.id, (entry) => ({
 ...entry,
 kbExport: { status:"error", error: message },
 }));
 const missing = message.match(/MODEL_NOT_PULLED:(\S+)/);
 if (missing) {
 const modelName = missing[1];
 toast({
 title: t(
 `Modello "${modelName}" non installato`,
 `Model "${modelName}" isn't pulled`,
 `Modèle "${modelName}" non installé`,
 `Modelo "${modelName}" no instalado`,
 `Modell "${modelName}" nicht installiert`,
 ),
 description: t(
"Premi Pull per scaricarlo automaticamente da Ollama.",
"Click Pull to download it automatically from Ollama.",
"Cliquez sur Pull pour le télécharger depuis Ollama.",
"Pulsa Pull para descargarlo automáticamente desde Ollama.",
"Auf Pull klicken, um es automatisch von Ollama zu laden.",
 ),
 variant:"destructive",
 action: (
 <ToastAction
 altText={t("Scarica modello","Pull model","Télécharger","Descargar","Laden")}
 onClick={() => { void pullEmbeddingModel(modelName, file); }}
 >
 {t("Scarica","Pull","Télécharger","Descargar","Laden")}
 </ToastAction>
 ),
 });
 return;
 }
 toast({
 title: t("Esportazione KB non riuscita","KB export failed","Échec d'export KB","Error de exportación KB","KB-Export fehlgeschlagen"),
 description: message,
 variant:"destructive",
 });
 }
 };

 const exportFileToS3 = async (file: ProcessingFile) => {
 if (!file.jobId) {
 toast({
 title: t("Nessun jobId","Missing jobId","jobId manquant","Falta jobId","jobId fehlt"),
 description: t(
"Solo i lavori OCR completati possono essere inviati su S3.",
"Only completed OCR jobs can be sent to S3.",
"Seuls les jobs OCR terminés peuvent être envoyés vers S3.",
"Solo se pueden enviar a S3 trabajos OCR completados.",
"Nur abgeschlossene OCR-Jobs können an S3 gesendet werden.",
 ),
 variant:"destructive",
 });
 return;
 }
 updateFileById(file.id, (entry) => ({ ...entry, s3Export: { status:"pending", phase:"queued", uploadedBytes: 0, totalBytes: 0 } }));
 try {
 const resp = await fetch("/api/s3/export", {
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify({ jobId: file.jobId }),
 });
 const payload = (await resp.json().catch(() => ({}))) as { error?: string; exportId?: string; bucket?: string };
 if (!resp.ok || !payload.exportId) {
 throw new Error(payload.error || `S3 export failed (${resp.status})`);
 }
 const exportId = payload.exportId;
 const finalEvent = await new Promise<{ phase:"done"|"error"; bucket: string; keys: string[]; totalBytes: number; error?: string }>((resolve, reject) => {
 const es = new EventSource(`/api/s3/export/${encodeURIComponent(exportId)}/stream`);
 es.addEventListener("progress", (event) => {
 try {
 const data = JSON.parse((event as MessageEvent).data) as { phase: string; bucket?: string; keys?: string[]; uploadedBytes?: number; totalBytes?: number; error?: string };
 updateFileById(file.id, (entry) => ({
 ...entry,
 s3Export: {
 status: data.phase === "done"?"success": data.phase === "error"?"error":"pending",
 phase: data.phase as "queued"|"reading"|"uploading"|"done"|"error",
 bucket: data.bucket ?? entry.s3Export?.bucket ?? payload.bucket,
 keys: data.keys ?? entry.s3Export?.keys,
 uploadedBytes: data.uploadedBytes ?? 0,
 totalBytes: data.totalBytes ?? 0,
 error: data.error,
 },
 }));
 if (data.phase === "done"|| data.phase === "error") {
 es.close();
 if (data.phase === "done") {
 resolve({ phase:"done", bucket: data.bucket ?? payload.bucket ??"", keys: data.keys ?? [], totalBytes: data.totalBytes ?? 0 });
 } else {
 reject(new Error(data.error || "S3 export failed"));
 }
 }
 } catch (err) {
 es.close();
 reject(err);
 }
 });
 es.onerror = () => {
 es.close();
 reject(new Error("Lost connection to S3 export progress stream"));
 };
 });
 toast({
 title: t("Inviato su S3","Sent to S3","Envoyé sur S3","Enviado a S3","An S3 gesendet"),
 description: finalEvent.keys.length > 0
 ? t(
 `${finalEvent.keys.length} oggetti in ${finalEvent.bucket}`,
 `${finalEvent.keys.length} objects in ${finalEvent.bucket}`,
 `${finalEvent.keys.length} objets dans ${finalEvent.bucket}`,
 `${finalEvent.keys.length} objetos en ${finalEvent.bucket}`,
 `${finalEvent.keys.length} Objekte in ${finalEvent.bucket}`,
 )
 : undefined,
 });
 } catch (error) {
 const message = error instanceof Error ? error.message :"Unknown error";
 updateFileById(file.id, (entry) => ({
 ...entry,
 s3Export: { status:"error", error: message },
 }));
 toast({
 title: t("Esportazione S3 non riuscita","S3 export failed","Échec d'export S3","Error de exportación S3","S3-Export fehlgeschlagen"),
 description: message,
 variant:"destructive",
 });
 }
 };

 const pullEmbeddingModel = async (model: string, file: ProcessingFile) => {
 toast({
 title: t(`Scaricamento ${model}...`,`Pulling ${model}...`,`Téléchargement de ${model}...`,`Descargando ${model}...`,`${model} wird geladen...`),
 description: t(
"Può richiedere alcuni minuti la prima volta.",
"This can take a few minutes the first time.",
"Cela peut prendre quelques minutes la première fois.",
"Puede tardar varios minutos la primera vez.",
"Beim ersten Mal kann es einige Minuten dauern.",
 ),
 });
 try {
 const resp = await fetch("/api/kb/pull-model", {
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify({ model }),
 });
 const payload = (await resp.json().catch(() => ({}))) as { error?: string };
 if (!resp.ok) throw new Error(payload.error || `Pull failed (${resp.status})`);
 toast({
 title: t(`${model} installato`,`${model} ready`,`${model} prêt`,`${model} listo`,`${model} bereit`),
 description: t(
"Riprovo l'esportazione...",
"Retrying the export...",
"Nouvelle tentative d'export...",
"Reintentando la exportación...",
"Export wird erneut versucht...",
 ),
 });
 await exportFileToKb(file);
 } catch (err) {
 toast({
 title: t("Pull non riuscito","Pull failed","Échec du téléchargement","Error de descarga","Pull fehlgeschlagen"),
 description: err instanceof Error ? err.message :"",
 variant:"destructive",
 });
 }
 };

 const handleFiles = async (fileList: FileList | File[]) => {
 const newFiles: ProcessingFile[] = [];

 for (const file of Array.from(fileList)) {
 const previewData = await buildInitialPreview(file);
 newFiles.push({
 id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
 name: file.name,
 size: file.size,
 type: file.type,
 status:"pending",
 progress: 0,
 preview: previewData.preview,
 pagePreviews: previewData.pagePreviews,
 pageCount: previewData.pageCount,
 processedPages: 0,
 etaSeconds: null,
 stage:"pending",
 stageMessage:"Ready",
 checkpoints: [],
 events: [],
 file,
 });
 }

 setFiles((prev) => [...prev, ...newFiles]);
 if (newFiles.length > 0 && !selectedFileId) {
 setSelectedFileId(newFiles[0].id);
 }

 const PARALLEL_PREPROCESS = 2;
 const pdfQueue = newFiles.filter((f) => f.file && isPdfFile(f.file));
 if (pdfQueue.length > 0) {
 for (const f of pdfQueue) {
 updateFileById(f.id, (entry) => ({ ...entry, isPreprocessing: true }));
 }
 void (async () => {
 const queue = [...pdfQueue];
 while (queue.length > 0) {
 const batch = queue.splice(0, PARALLEL_PREPROCESS);
 await Promise.allSettled(
 batch.map(async (f) => {
 try {
 await ensurePagePreviews(f);
 } catch {
 /* ignore */
 } finally {
 updateFileById(f.id, (entry) => ({ ...entry, isPreprocessing: false }));
 }
 }),
 );
 }
 })();
 }

 toast({
 title: t("File aggiunti","Files added","Fichiers ajoutés","Archivos añadidos","Dateien hinzugefügt"),
 description: t(
`${newFiles.length} file pronti per l'OCR`,
`${newFiles.length} file${newFiles.length === 1 ?"":"s"} ready for OCR`,
`${newFiles.length} fichier${newFiles.length === 1 ?"":"s"} prêt${newFiles.length === 1 ?"":"s"} pour l'OCR`,
`${newFiles.length} archivo${newFiles.length === 1 ?"":"s"} listo${newFiles.length === 1 ?"":"s"} para el OCR`,
`${newFiles.length} ${newFiles.length === 1 ?"Datei":"Dateien"} bereit für OCR`,
 ),
 });
 };

 const handleDragOver = (e: React.DragEvent) => {
 e.preventDefault();
 setIsDragOver(true);
 };

 const handleDragLeave = (e: React.DragEvent) => {
 e.preventDefault();
 setIsDragOver(false);
 };

 const handleDrop = async (e: React.DragEvent) => {
 e.preventDefault();
 setIsDragOver(false);
 const collected = await collectDroppedFiles(e.dataTransfer.items);
 if (collected.length > 0) {
 const dt = new DataTransfer();
 collected.forEach((f) => dt.items.add(f));
 handleFiles(dt.files);
 return;
 }
 if (e.dataTransfer.files.length > 0) {
 handleFiles(e.dataTransfer.files);
 }
 };

 const removeFile = (id: string) => {
 setFiles((prev) => prev.filter((f) => f.id !== id));
 setBulkSelectedIds((prev) => {
 if (!prev.has(id)) return prev;
 const next = new Set(prev);
 next.delete(id);
 return next;
 });
 if (selectedFileId === id) {
 const remaining = files.filter((f) => f.id !== id);
 setSelectedFileId(remaining[0]?.id || null);
 }
 };

 const clearAllFiles = () => {
 setFiles([]);
 setSelectedFileId(null);
 setBulkSelectedIds(new Set());
 void clearQueue();
 };

 const toggleBulkSelected = React.useCallback((id: string) => {
 setBulkSelectedIds((prev) => {
 const next = new Set(prev);
 if (next.has(id)) next.delete(id);
 else next.add(id);
 return next;
 });
 }, []);

 const removeBulkSelected = React.useCallback(() => {
 setBulkSelectedIds((prev) => {
 if (prev.size === 0) return prev;
 const ids = prev;
 setFiles((current) => current.filter((f) => !ids.has(f.id)));
 setSelectedFileId((curr) => (curr && ids.has(curr) ? null : curr));
 return new Set();
 });
 }, []);

 const copyToClipboard = async (type:"md"|"json") => {
 if (!selectedFile?.result) return;

 const text = type ==="md"? selectedFileMarkdown
 : JSON.stringify(selectedFileStructuredJson, null, 2);
 await navigator.clipboard.writeText(text);
 setCopied(type);
 setTimeout(() => setCopied(null), 2000);

 toast({
 title: t("Copiato negli appunti","Copied to clipboard!","Copié dans le presse-papiers !","¡Copiado al portapapeles!","In Zwischenablage kopiert!"),
 description: t(
`Contenuto ${type ==="md"?"Markdown":"JSON"} copiato`,
`${type ==="md"?"Markdown":"JSON"} content has been copied`,
`Contenu ${type ==="md"?"Markdown":"JSON"} copié`,
`Contenido ${type ==="md"?"Markdown":"JSON"} copiado`,
`${type ==="md"?"Markdown":"JSON"}-Inhalt kopiert`,
 ),
 });
 };

 const downloadResult = (type:"md"|"json") => {
 if (!selectedFile?.result) return;

 const text = type ==="md"? selectedFileMarkdown
 : JSON.stringify(selectedFileStructuredJson, null, 2);
 const blob = new Blob([text], { type: type ==="md"?"text/markdown":"application/json"});
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `${selectedFile.name.replace(/\.[^/.]+$/,"")}.${type ==="md"?"md":"json"}`;
 a.click();
 URL.revokeObjectURL(url);

 toast({
 title: t("Download avviato","Download started","Téléchargement démarré","Descarga iniciada","Download gestartet"),
 description: t(
`${selectedFile.name}.${type ==="md"?"md":"json"} in download`,
`${selectedFile.name}.${type ==="md"?"md":"json"} is downloading`,
`${selectedFile.name}.${type ==="md"?"md":"json"} en téléchargement`,
`Descargando ${selectedFile.name}.${type ==="md"?"md":"json"}`,
`${selectedFile.name}.${type ==="md"?"md":"json"} wird heruntergeladen`,
 ),
 });
 };

 const exportAllAsZip = async () => {
 const completedFiles = files.filter((f) => f.status ==="completed"&& f.result);
 if (completedFiles.length === 0) {
 toast({
 title: t("Nessun file da esportare","No files to export","Aucun fichier à exporter","No hay archivos para exportar","Keine Dateien zum Exportieren"),
 description: t("Elabora prima alcuni file, poi esporta","Process some files first before exporting","Traitez d'abord des fichiers avant d'exporter","Procesa archivos primero antes de exportar","Verarbeite zuerst einige Dateien, dann exportieren"),
 variant:"destructive",
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
 const baseName = file.name.replace(/\.[^/.]+$/,"");
 mdFolder?.file(`${baseName}.md`, getMarkdownFromJsonPayload(file.result.json, file.result.text));
 jsonFolder?.file(`${baseName}.json`, JSON.stringify(getStructuredJsonPayload(file.result.json), null, 2));
 }
 });

 // Generate and download zip
 const content = await zip.generateAsync({ type:"blob"});
 const url = URL.createObjectURL(content);
 const a = document.createElement("a");
 a.href = url;
 a.download = `estraction-${Date.now()}.zip`;
 a.click();
 URL.revokeObjectURL(url);

 toast({
 title: t("Esportazione completata","Export complete!","Exportation terminée !","¡Exportación completada!","Export abgeschlossen!"),
 description: t(
`${completedFiles.length} file esportati in ZIP`,
`${completedFiles.length} files exported to a ZIP archive`,
`${completedFiles.length} fichiers exportés dans une archive ZIP`,
`${completedFiles.length} archivos exportados a ZIP`,
`${completedFiles.length} Dateien als ZIP exportiert`,
 ),
 });
 };

 React.useEffect(() => {
 if (!selectedFile || !selectedFile.file || !isPdfFile(selectedFile.file)) {
 setAllPagePreviews([]);
 setAllPagePreviewsForFileId(null);
 return;
 }
 if (allPagePreviewsForFileId === selectedFile.id && allPagePreviews.length > 0) {
 return;
 }
 if (selectedFile.status !== "pending" && selectedFile.status !== "completed") {
 return;
 }
 const cached = pdfPagePreviewCacheRef.current[selectedFile.id];
 if (Array.isArray(cached) && cached.length > 0) {
 setAllPagePreviews(cached);
 setAllPagePreviewsForFileId(selectedFile.id);
 return;
 }
 if ((selectedFile.pageCount ?? 1) <= 1) {
 const single = selectedFile.preview?.trim();
 setAllPagePreviews(single ? [single] : []);
 setAllPagePreviewsForFileId(selectedFile.id);
 return;
 }
 let cancelled = false;
 setIsLoadingAllPagePreviews(true);
 (async () => {
 try {
 const pages = await ensurePagePreviews(selectedFile);
 if (!cancelled) {
 setAllPagePreviews(pages);
 setAllPagePreviewsForFileId(selectedFile.id);
 if (pages.length > 1) {
 updateFileById(selectedFile.id, (entry) =>
 Array.isArray(entry.selectedPages)
 ? entry
 : { ...entry, selectedPages: Array.from({ length: pages.length }, (_, i) => i + 1) },
 );
 }
 }
 } catch {
 if (!cancelled) {
 setAllPagePreviews([]);
 setAllPagePreviewsForFileId(null);
 }
 } finally {
 if (!cancelled) setIsLoadingAllPagePreviews(false);
 }
 })();
 return () => {
 cancelled = true;
 };
 }, [selectedFile?.id, selectedFile?.pageCount, selectedFile?.status]);

 const ensurePagePreviews = async (file: ProcessingFile): Promise<string[]> => {
 if (file.file && isPdfFile(file.file)) {
 const inMemoryPages = pdfPagePreviewCacheRef.current[file.id];
 if (Array.isArray(inMemoryPages) && inMemoryPages.length > 0) {
 return inMemoryPages;
 }

 const cachedPages = Array.isArray(file.pagePreviews) ? file.pagePreviews.filter(Boolean) : [];
 if (cachedPages.length > 1) {
 pdfPagePreviewCacheRef.current[file.id] = cachedPages;
 return cachedPages;
 }

 const firstPage = cachedPages[0] || file.preview?.trim() ||"";
 const remainingPages = firstPage
 ? await renderPdfPagesAsImages(file.file, { startPage: 2 })
 : await renderPdfPagesAsImages(file.file, { startPage: 1 });
 const renderedPages = firstPage ? [firstPage, ...remainingPages] : remainingPages;
 if (renderedPages.length === 0) {
 throw new Error("Unable to render PDF pages for OCR");
 }
 pdfPagePreviewCacheRef.current[file.id] = renderedPages;
 void (async () => {
 const r = await persistPagePreviews(file.id, renderedPages);
 if (!r.ok && !persistQuotaWarnedRef.current) {
 persistQuotaWarnedRef.current = true;
 toast({
 title: t(
"Salvataggio anteprime non riuscito",
"Could not cache previews",
"Échec du cache des aperçus",
"No se pudo guardar la vista previa",
"Vorschau konnte nicht zwischengespeichert werden",
 ),
 description: t(
"Lo spazio del browser è esaurito. La coda non sopravvivrà al refresh.",
"Browser storage is full. The queue will not survive a refresh.",
"Le stockage du navigateur est plein. La file ne survivra pas au rafraîchissement.",
"El almacenamiento del navegador está lleno. La cola no sobrevivirá a un refresco.",
"Browser-Speicher voll. Die Warteschlange überlebt keinen Refresh.",
 ),
 variant: "destructive",
 });
 }
 })();

 updateFileById(file.id, (entry) => ({
 ...entry,
 preview: renderedPages[0],
 pagePreviews: renderedPages.length > 0 ? [renderedPages[0]] : [],
 pageCount: renderedPages.length,
 }));

 return renderedPages;
 }

 if (file.preview?.trim()) {
 return [file.preview.trim()];
 }

 return [];
 };

 const parseProgressMetadata = (metadata: unknown) => {
 if (!metadata || typeof metadata !=="object"|| Array.isArray(metadata)) {
 return null;
 }
 const value = metadata as Record<string, unknown>;
 const checkpoints = Array.isArray(value.checkpoints)
 ? value.checkpoints
 .map((item) => {
 if (!item || typeof item !=="object"|| Array.isArray(item)) return null;
 const typed = item as Record<string, unknown>;
 if (typeof typed.pageNumber !=="number") return null;
 return {
 pageNumber: typed.pageNumber,
 previewText: typeof typed.previewText ==="string"? typed.previewText : undefined,
 characterCount:
 typeof typed.characterCount ==="number"? typed.characterCount : undefined,
 durationMs: typeof typed.durationMs ==="number"? typed.durationMs : undefined,
 } as OcrPageCheckpointView;
 })
 .filter(Boolean) as OcrPageCheckpointView[]
 : [];
 const events = Array.isArray(value.events)
 ? value.events
 .map((item) => {
 if (!item || typeof item !=="object"|| Array.isArray(item)) return null;
 const typed = item as Record<string, unknown>;
 return {
 at: typeof typed.at ==="string"? typed.at : undefined,
 stage: typeof typed.stage ==="string"? typed.stage : undefined,
 message: typeof typed.message ==="string"? typed.message : undefined,
 } as OcrProgressEventView;
 })
 .filter(Boolean) as OcrProgressEventView[]
 : [];

 return {
 stage: typeof value.stage ==="string"? value.stage : undefined,
 message: typeof value.message ==="string"? value.message : undefined,
 progressPct: typeof value.progressPct ==="number"? value.progressPct : undefined,
 pageCount: typeof value.pageCount ==="number"? value.pageCount : undefined,
 processedPages: typeof value.processedPages ==="number"? value.processedPages : undefined,
 etaSeconds: typeof value.etaSeconds ==="number"? value.etaSeconds : null,
 checkpoints,
 events,
 };
 };

 const pollJobUntilStopped = async (
 fileId: string,
 jobId: string
 ): Promise<{
 status:"completed"|"paused";
 text?: string;
 json?: Record<string, unknown>;
 error?: string;
 }> => {
 while (true) {
 const response = await fetch(`/api/jobs/${jobId}`, { cache:"no-store"});
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
 updateFileById(fileId, (entry) => {
 const nextStatus: ProcessingFile["status"] =
 job.status ==="COMPLETED"?"completed": job.status ==="FAILED"?"error": job.status ==="QUEUED"&& progressMeta?.stage ==="paused"?"paused":"processing";
 return {
 ...entry,
 jobId,
 status: nextStatus,
 progress:
 typeof progressMeta?.progressPct ==="number"? Math.max(0, Math.min(100, progressMeta.progressPct))
 : entry.progress,
 pageCount: progressMeta?.pageCount ?? entry.pageCount,
 processedPages: progressMeta?.processedPages ?? entry.processedPages,
 etaSeconds:
 progressMeta?.etaSeconds === null || typeof progressMeta?.etaSeconds ==="number"? progressMeta.etaSeconds
 : entry.etaSeconds,
 stage: progressMeta?.stage || entry.stage,
 stageMessage: progressMeta?.message || entry.stageMessage,
 checkpoints: progressMeta?.checkpoints ?? entry.checkpoints,
 events: progressMeta?.events ?? entry.events,
 result:
 job.result && typeof job.result ==="object"&& !Array.isArray(job.result)
 ? {
 text:
 typeof job.extractedText ==="string"? job.extractedText
 : entry.result?.text ||"",
 json: job.result as Record<string, unknown>,
 }
 : entry.result,
 error:
 job.status ==="FAILED"? job.errorMessage || t("Elaborazione non riuscita","Processing failed","Échec du traitement","Procesamiento fallido","Verarbeitung fehlgeschlagen")
 : entry.error,
 };
 });

 if (job.status ==="COMPLETED") {
 return {
 status:"completed",
 text: typeof job.extractedText ==="string"? job.extractedText :"",
 json:
 job.result && typeof job.result ==="object"&& !Array.isArray(job.result)
 ? (job.result as Record<string, unknown>)
 : {},
 };
 }
 if (job.status ==="FAILED") {
 throw new Error(job.errorMessage || t("Elaborazione non riuscita","Processing failed","Échec du traitement","Procesamiento fallido","Verarbeitung fehlgeschlagen"));
 }
 if (job.status ==="QUEUED"&& progressMeta?.stage ==="paused") {
 return { status:"paused"};
 }

 await sleep(1000);
 }
 };

 const startOrResumeOcr = async (
 file: ProcessingFile,
 pagePreviews: string[],
 resume = false,
 pageNumbers?: number[],
 ): Promise<{ jobId: string }> => {
 const SOURCE_PDF_MAX_BYTES = 32 * 1024 * 1024;
 let sourcePdf: string | undefined;
 if (file.file && isPdfFile(file.file) && file.file.size <= SOURCE_PDF_MAX_BYTES) {
 try {
 const buffer = await getPdfArrayBuffer(file.file);
 const bytes = new Uint8Array(buffer);
 const chunkSize = 0x8000;
 let binary = "";
 for (let i = 0; i < bytes.length; i += chunkSize) {
 binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
 }
 const b64 = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
 sourcePdf = `data:application/pdf;base64,${b64}`;
 } catch {
 sourcePdf = undefined;
 }
 }
 const response = await fetch("/api/ocr", {
 method:"POST",
 headers: {
"Content-Type":"application/json",
 },
 body: JSON.stringify({
 jobId: file.jobId,
 resume,
 fileName: file.name,
 model: selectedModel,
 preview: pagePreviews[0],
 pages: pagePreviews,
 ...(pageNumbers ? { pageNumbers } : {}),
 ...(sourcePdf ? { sourcePdf } : {}),
 settings,
 postProcessing,
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
 const allPreviews = await ensurePagePreviews(file);
 if (allPreviews.length === 0) {
 throw new Error("No image preview available for OCR");
 }
 let pagePreviews = allPreviews;
 let pageNumbers: number[] | undefined;
 const selection = file.selectedPages;
 if (Array.isArray(selection) && selection.length === 0 && allPreviews.length > 1) {
 throw new Error(
 t("Seleziona almeno una pagina prima di avviare l'OCR.","Select at least one page before running OCR.","Sélectionnez au moins une page avant de lancer l'OCR.","Selecciona al menos una página antes de iniciar OCR.","Wähle mindestens eine Seite, bevor du OCR startest."),
 );
 }
 if (selection && selection.length > 0 && selection.length < allPreviews.length) {
 const sorted = [...selection].sort((a, b) => a - b);
 const deduped = Array.from(new Set(sorted));
 const valid = deduped.filter((n) => n >= 1 && n <= allPreviews.length);
 if (valid.length > 0) {
 pagePreviews = valid.map((n) => allPreviews[n - 1]);
 pageNumbers = valid;
 }
 }

 updateFileById(file.id, (entry) => ({
 ...entry,
 status:"processing",
 progress: Math.max(entry.progress, 1),
 stage: resume ?"resuming":"queued",
 stageMessage: resume
 ? t("Ripresa dal checkpoint...","Resuming from checkpoint...","Reprise depuis le checkpoint...","Reanudando desde checkpoint...","Wird vom Checkpoint fortgesetzt...")
 : t(
`In coda per OCR (${pagePreviews.length} pagine)`,
`Queued for OCR (${pagePreviews.length} pages)`,
`En file d'attente OCR (${pagePreviews.length} pages)`,
`En cola para OCR (${pagePreviews.length} páginas)`,
`In OCR-Warteschlange (${pagePreviews.length} Seiten)`,
 ),
 pageCount: pagePreviews.length,
 processedPages: entry.processedPages || 0,
 etaSeconds: null,
 error: undefined,
 }));

 const startPayload = await startOrResumeOcr(file, pagePreviews, resume, pageNumbers);
 updateFileById(file.id, (entry) => ({
 ...entry,
 jobId: startPayload.jobId,
 }));

 return pollJobUntilStopped(file.id, startPayload.jobId);
 };

 const processFiles = async (filterIds?: Set<string>) => {
 if (files.length === 0) return;
 if (!selectedModel.trim()) {
 toast({
 title: t("Modello mancante","Missing model","Modèle manquant","Modelo faltante","Modell fehlt"),
 description: t(
"Seleziona prima un modello disponibile per il provider scelto.",
"Select an available model for the selected provider first."),
 variant:"destructive",
 });
 return;
 }
 if (!isRunReady) {
 toast({
 title: t("Istruzione post-processing mancante","Missing post-processing instruction","Instruction de post-traitement manquante","Falta instrucción de post-procesamiento","Anweisung für Nachverarbeitung fehlt"),
 description: t("Aggiungi un'istruzione o disattiva il post-processing prima di avviare l'OCR.","Add an instruction or disable post-processing before running OCR.","Ajoutez une instruction ou désactivez le post-traitement avant de lancer l'OCR.","Añade una instrucción o desactiva el post-procesamiento antes de iniciar OCR.","Anweisung hinzufügen oder Nachverarbeitung deaktivieren, bevor OCR gestartet wird."),
 variant:"destructive",
 });
 return;
 }

 setIsProcessing(true);
 const filesToProcess = files.filter((f) => f.status ==="pending"&& (!filterIds || filterIds.has(f.id)));
 let completedInRun = 0;

 for (const file of filesToProcess) {
 try {
 const result = await processSingleFile(file, false);
 if (result.status ==="completed") {
 completedInRun += 1;
 } else if (result.status ==="paused") {
 toast({
 title: t("OCR in pausa","OCR paused","OCR en pause","OCR en pausa","OCR pausiert"),
 description: t(
`${file.name} messo in pausa al checkpoint. Premi Riprendi per continuare.`,
`${file.name} paused at checkpoint. Click Resume to continue.`,
`${file.name} en pause au checkpoint. Cliquez sur Reprendre pour continuer.`,
`${file.name} en pausa en el checkpoint. Pulsa Reanudar para continuar.`,
`${file.name} am Checkpoint pausiert. Auf Fortsetzen klicken, um weiterzumachen.`,
 ),
 });
 break;
 }
 } catch (error) {
 updateFileById(file.id, (entry) => ({
 ...entry,
 status:"error",
 error: error instanceof Error ? error.message : t("Elaborazione non riuscita","Processing failed","Échec du traitement","Procesamiento fallido","Verarbeitung fehlgeschlagen"),
 }));
 }
 }

 setIsProcessing(false);
 if (completedInRun > 0) {
 toast({
 title: t("Elaborazione completata","Processing complete","Traitement terminé","Procesamiento completado","Verarbeitung abgeschlossen"),
 description: t(
`${completedInRun} file elaborati con successo`,
`${completedInRun} file${completedInRun === 1 ?"":"s"} processed successfully`,
`${completedInRun} fichier${completedInRun === 1 ?"":"s"} traité${completedInRun === 1 ?"":"s"} avec succès`,
`${completedInRun} archivo${completedInRun === 1 ?"":"s"} procesado${completedInRun === 1 ?"":"s"} correctamente`,
`${completedInRun} ${completedInRun === 1 ?"Datei":"Dateien"} erfolgreich verarbeitet`,
 ),
 });
 }
 };

 const stopProcessingFile = async (file: ProcessingFile) => {
 if (!file.jobId || file.status !=="processing") {
 return;
 }
 try {
 const response = await fetch(`/api/jobs/${file.jobId}/control`, {
 method:"POST",
 headers: {
"Content-Type":"application/json",
 },
 body: JSON.stringify({
 action:"stop",
 }),
 });
 if (!response.ok) {
 const payload = (await response.json().catch(() => ({}))) as { error?: string };
 throw new Error(payload.error || `Stop failed (${response.status})`);
 }
 updateFileById(file.id, (entry) => ({
 ...entry,
 stageMessage: t("Stop richiesto. Interruzione inferenza corrente...","Stop requested. Aborting current inference...","Arrêt demandé. Interruption de l'inférence en cours...","Detención solicitada. Abortando la inferencia actual...","Stopp angefordert. Aktuelle Inferenz wird abgebrochen..."),
 }));
 toast({
 title: t("Stop richiesto","Stop requested","Arrêt demandé","Detención solicitada","Stopp angefordert"),
 description: t("Interruzione immediata dell'inferenza e scaricamento del modello.","Aborting current inference now and unloading the model.","Interruption immédiate de l'inférence et déchargement du modèle.","Aborto inmediato de la inferencia y descarga del modelo.","Aktuelle Inferenz wird sofort abgebrochen und Modell entladen."),
 });
 } catch (error) {
 toast({
 title: t("Stop non riuscito","Stop failed","Échec de l'arrêt","Detención fallida","Stopp fehlgeschlagen"),
 description: error instanceof Error ? error.message : t("Impossibile fermare l'OCR","Unable to stop OCR","Impossible d'arrêter l'OCR","No se pudo detener el OCR","OCR konnte nicht gestoppt werden"),
 variant:"destructive",
 });
 }
 };

 const resumeProcessingFile = async (file: ProcessingFile) => {
 if (file.status !=="paused") {
 return;
 }
 setIsProcessing(true);
 try {
 const result = await processSingleFile(file, true);
 if (result.status ==="completed") {
 toast({
 title: t("Ripresa completata","Resume complete","Reprise terminée","Reanudación completa","Fortsetzen abgeschlossen"),
 description: t(
`${file.name} ripreso e completato con successo.`,
`${file.name} resumed and finished successfully.`,
`${file.name} repris et terminé avec succès.`,
`${file.name} reanudado y completado con éxito.`,
`${file.name} fortgesetzt und erfolgreich abgeschlossen.`,
 ),
 });
 }
 } catch (error) {
 updateFileById(file.id, (entry) => ({
 ...entry,
 status:"error",
 error: error instanceof Error ? error.message : t("Ripresa non riuscita","Resume failed","Échec de la reprise","Reanudación fallida","Fortsetzen fehlgeschlagen"),
 }));
 toast({
 title: t("Ripresa non riuscita","Resume failed","Échec de la reprise","Reanudación fallida","Fortsetzen fehlgeschlagen"),
 description: error instanceof Error ? error.message : t("Impossibile riprendere l'OCR","Unable to resume OCR","Impossible de reprendre l'OCR","No se pudo reanudar el OCR","OCR konnte nicht fortgesetzt werden"),
 variant:"destructive",
 });
 } finally {
 setIsProcessing(false);
 }
 };

 const signOut = async () => {
 setIsSigningOut(true);
 try {
 const response = await fetch("/api/auth/signout", { method:"POST"});
 if (!response.ok) {
 throw new Error(`Sign out failed (${response.status})`);
 }

 router.replace("/auth");
 } catch (error) {
 toast({
 title: t("Disconnessione non riuscita","Sign out failed","Échec de la déconnexion","Error al cerrar sesión","Abmelden fehlgeschlagen"),
 description: error instanceof Error ? error.message : t("Riprova","Please try again","Veuillez réessayer","Por favor, inténtalo de nuevo","Bitte erneut versuchen"),
 variant:"destructive",
 });
 } finally {
 setIsSigningOut(false);
 }
 };

 return (
 <div className="h-screen overflow-hidden flex flex-col no-scrollbars">
      <HeaderBar
        t={t}
        onOpenSettings={openSettingsTab}
        onChangePassword={() => setChangePasswordOpen(true)}
        onSignOut={signOut}
        isSigningOut={isSigningOut}
      />

      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        t={t}
      />

 <Dialog
 open={apiSettingsOpen}
 onOpenChange={(open) => {
 setApiSettingsOpen(open);
 if (!open) {
 setApiSettingsDraft(apiSettings);
 setApiKeyDirty(false);
 setKbDefaultsDraft(kbDefaults);
 setKbEmbeddingKeyDirty(false);
 setKbStoreKeyDirty(false);
 }
 }}
 >
 <DialogContent className="w-[96vw] !max-w-3xl max-h-[92vh] flex flex-col overflow-hidden p-0">
 <div className="px-6 pt-6 pb-3">
 <DialogHeader>
 <DialogTitle>{t("Impostazioni","Settings","Paramètres","Configuración","Einstellungen")}</DialogTitle>
 <DialogDescription>
 {t(
"Modello, parametri OCR, knowledge base, provider e chiavi API.",
"Model, OCR parameters, knowledge base, provider, and API keys.",
"Modèle, paramètres OCR, base de connaissances, fournisseur et clés API.",
"Modelo, parámetros OCR, base de conocimiento, proveedor y claves API.",
"Modell, OCR-Parameter, Wissensdatenbank, Provider und API-Schlüssel.",
 )}
 </DialogDescription>
 </DialogHeader>
 </div>

 <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as typeof settingsTab)} className="flex-1 min-h-0 flex flex-col gap-0">
 <div className="px-6">
 <TabsList className="w-full justify-start gap-0.5">
 <TabsTrigger value="model"className="gap-1.5 px-2.5"><SparklesIcon size={14} className="inline-flex items-center justify-center"/>{t("Modello","Model","Modèle","Modelo","Modell")}</TabsTrigger>
 <TabsTrigger value="kb"className="gap-1.5 px-2.5"><DatabaseBackupIcon size={14} className="inline-flex items-center justify-center"/>KB</TabsTrigger>
 <TabsTrigger value="provider"className="gap-1.5 px-2.5"><SettingsIcon size={14} className="inline-flex items-center justify-center"/>{t("Provider","Provider","Fournisseur","Proveedor","Anbieter")}</TabsTrigger>
 <TabsTrigger value="general"className="gap-1.5 px-2.5"><LanguagesIcon size={14} className="inline-flex items-center justify-center"/>{t("Generale","General","Général","General","Allgemein")}</TabsTrigger>
 <TabsTrigger value="keys"className="gap-1.5 px-2.5"><KeyRoundIcon size={14} className="inline-flex items-center justify-center"/>{t("Chiavi","Keys","Clés","Claves","Schlüssel")}</TabsTrigger>
 <TabsTrigger value="s3"className="gap-1.5 px-2.5"><Cloud className="size-3.5"/>S3</TabsTrigger>
 <TabsTrigger value="templates"className="gap-1.5 px-2.5"><Layers className="size-3.5"/>{t("Template","Templates","Modèles","Plantillas","Vorlagen")}</TabsTrigger>
 <TabsTrigger value="notifications"className="gap-1.5 px-2.5"><BellRing className="size-3.5"/>{t("Notifiche","Push","Push","Push","Push")}</TabsTrigger>
 </TabsList>
 </div>

 <ScrollArea className="flex-1 min-h-0 px-6 pb-2">
 <TabsContent value="model"className="space-y-5 mt-4">
 <SettingsSection
 title={t("Modello OCR","OCR model","Modèle OCR","Modelo OCR","OCR-Modell")}
 hint={t(
"Il modello che legge ogni pagina e ne tira fuori il testo. Cerca per nome, oppure incolla un ID se il provider non lo elenca.",
"The model that reads each page and pulls the text out. Search by name, or paste an ID if the provider doesn't list it.",
"Le modèle qui lit chaque page et en extrait le texte. Cherchez par nom ou collez un ID si le fournisseur ne le liste pas.",
"El modelo que lee cada página y extrae el texto. Busca por nombre o pega un ID si el proveedor no lo lista.",
"Das Modell, das jede Seite liest und den Text extrahiert. Suche per Name, oder füge eine ID ein, falls der Anbieter sie nicht listet.",
)}
 >
 <Combobox
 options={models.map((m) => ({ value: m.id, label: m.name, hint: m.provider }))}
 value={selectedModel}
 onValueChange={setSelectedModel}
 placeholder={isLoadingModels ? t("Caricamento modelli...","Loading models...","Chargement...","Cargando...","Wird geladen...") : t("Seleziona modello","Select model","Choisir","Seleccionar","Wählen")}
 searchPlaceholder={t("Cerca modello...","Search model...","Rechercher un modèle...","Buscar modelo...","Modell suchen...")}
 emptyText={t("Nessun modello disponibile","No models available","Aucun modèle","Sin modelos","Keine Modelle")}
 loading={isLoadingModels}
 onRefresh={() => { void fetchAvailableModels(apiSettings); }}
 refreshLabel={t("AGGIORNA","REFRESH","ACTUALISER","ACTUALIZAR","AKTUALISIEREN")}
 allowCustom
 ariaLabel={t("Modello OCR","OCR model","Modèle OCR","Modelo OCR","OCR-Modell")}
 />
 {modelError ? <p className="text-[11px] text-destructive">{modelError}</p> : null}
 </SettingsSection>

 <SettingsSection
 title={t("Pagine in parallelo","Pages in parallel","Pages en parallèle","Páginas en paralelo","Seiten parallel")}
 hint={t(
"Numero di pagine OCR contemporanee per ogni job. 0 = automatico (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Massimo 16.",
"How many OCR pages run in parallel per job. 0 = auto (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Max 16.",
"Nombre de pages OCR exécutées en parallèle par job. 0 = auto (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Max 16.",
"Cuántas páginas OCR se ejecutan en paralelo por trabajo. 0 = automático (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Máximo 16.",
"Wie viele OCR-Seiten parallel pro Job laufen. 0 = automatisch (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Max. 16.",
 )}
 >
 <div className="flex items-center gap-2">
 <Input
 type="number"
 min={0}
 max={16}
 value={settings.pageConcurrency}
 onChange={(e) => {
 const raw = Number(e.target.value);
 const next = Number.isFinite(raw) ? Math.max(0, Math.min(16, Math.trunc(raw))) : 0;
 setSettings((s) => ({ ...s, pageConcurrency: next }));
 }}
 placeholder="0"
 className="max-w-[6rem]"
 />
 {settings.pageConcurrency === 0 ? (
 <Badge variant="outline" className="text-[10px]">
 {t("auto","auto","auto","auto","auto")}
 </Badge>
 ) : null}
 </div>
 </SettingsSection>

 <SettingsSection
 title={t("Post-processing","Post-processing","Post-traitement","Post-procesamiento","Nachverarbeitung")}
 hint={t(
"Una seconda passata facoltativa: riformatta il risultato OCR o estrae campi specifici (es. tabelle, totali, schede prodotto).",
"An optional second pass: reformat the OCR output or pull out specific fields (think tables, totals, product cards).",
"Une seconde passe optionnelle : reformatte la sortie OCR ou en extrait des champs précis (tableaux, totaux, fiches produit).",
"Una segunda pasada opcional: reformatea la salida OCR o extrae campos concretos (tablas, totales, fichas).",
"Ein optionaler zweiter Durchgang: formatiert die OCR-Ausgabe um oder extrahiert bestimmte Felder (Tabellen, Summen, Produktkarten).",
)}
 right={
 <Switch checked={postProcessing.enabled} onCheckedChange={(enabled) => setPostProcessing((prev) => ({ ...prev, enabled }))} />
 }
 >
 {postProcessing.enabled ? (
 <div className="space-y-3 surface-soft rounded-xl p-3 mt-2">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 {t("Istruzione","Instruction","Instruction","Instrucción","Anweisung")}
 </Label>
 <Textarea
 placeholder={t(
"Esempio: estrai numero fattura, scadenza e totali. Restituisci una tabella.",
"Example: extract invoice number, due date, totals. Return one table.",
"Exemple : extraire numéro de facture, échéance, totaux. Renvoyer un tableau.",
"Ejemplo: extrae número de factura, vencimiento, totales. Devuelve una tabla.",
"Beispiel: Rechnungsnummer, Fälligkeit, Summen extrahieren. Eine Tabelle zurückgeben.",
 )}
 value={postProcessing.instruction}
 onChange={(e) => setPostProcessing((prev) => ({ ...prev, instruction: e.target.value }))}
 className="min-h-24 text-xs"/>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Modello","Model","Modèle","Modelo","Modell")}</Label>
 <Select value={postProcessModelValue} onValueChange={(value) => setPostProcessing((prev) => ({ ...prev, model: value ==="__same__"?"": value }))}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="__same__">{t(`Uguale al modello OCR`, `Same as OCR model`,`Identique au modèle OCR`,`Igual que el OCR`,`Wie OCR-Modell`)}</SelectItem>
 {!selectedPostProcessModelExists && postProcessing.model ? (
 <SelectItem value={postProcessing.model}>{postProcessing.model}</SelectItem>
 ) : null}
 {models.map((model) => (
 <SelectItem key={`pp-${model.id}`} value={model.id}>{model.name}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Formato","Format","Format","Formato","Format")}</Label>
 <Select value={postProcessing.outputFormat} onValueChange={(value: PostProcessOutputFormat) => setPostProcessing((prev) => ({ ...prev, outputFormat: value }))}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="markdown">Markdown</SelectItem>
 <SelectItem value="json">{t("JSON strutturato","Structured JSON","JSON structuré","JSON estructurado","Strukturiertes JSON")}</SelectItem>
 </SelectContent>
 </Select>
 </div>
 </div>
 </div>
 ) : null}
 </SettingsSection>
 </TabsContent>

 <TabsContent value="kb"className="space-y-5 mt-4">
 <p className="text-xs text-muted-foreground">
 {t(
"Configura embedding, chunking e vector store.",
"Configure embedding, chunking, and vector store.",
"Configurez embedding, découpage et vector store.",
"Configura embedding, chunking y vector store.",
"Konfigurieren Sie Embedding, Chunking und Vektor-Store.",
 )}
 </p>

 <SettingsSection title={t("Embedding","Embedding","Embedding","Embedding","Embedding")}>
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Provider","Provider","Fournisseur","Proveedor","Anbieter")}</Label>
 <Select value={kbDefaultsDraft.embeddingProvider} onValueChange={(value) => setKbDefaultsDraft((p) => ({ ...p, embeddingProvider: value as KbEmbeddingProvider }))}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="ollama">Ollama</SelectItem>
 <SelectItem value="openrouter">OpenRouter</SelectItem>
 <SelectItem value="openai_compat">OpenAI-compatible</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 {t("Dimensioni","Dimensions","Dimensions","Dimensiones","Dimensionen")}
 <HintInfo text={t(
"Quanti numeri ha ogni vettore. Devi metterlo uguale a quello del modello (es. nomic-embed-text → 768).",
"How many numbers each vector has. Match the model's value (e.g. nomic-embed-text → 768).",
"Le nombre de valeurs par vecteur. Doit correspondre à celui du modèle (ex. nomic-embed-text → 768).",
"Cuántos números tiene cada vector. Debe coincidir con el del modelo (p. ej. nomic-embed-text → 768).",
"Wie viele Zahlen jeder Vektor hat. Muss zum Modell passen (z. B. nomic-embed-text → 768).",
)} />
 </span>
 </Label>
 <Input type="number"min={1} max={32768} value={kbDefaultsDraft.embeddingDimensions} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, embeddingDimensions: e.target.value }))} placeholder="768"/>
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Endpoint</Label>
 <Input value={kbDefaultsDraft.embeddingEndpoint} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, embeddingEndpoint: e.target.value }))} placeholder="http://127.0.0.1:11434"/>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Modello","Model","Modèle","Modelo","Modell")}</Label>
 <Combobox
 options={embeddingModelOptions}
 value={kbDefaultsDraft.embeddingModel}
 onValueChange={(value) => setKbDefaultsDraft((p) => ({ ...p, embeddingModel: value }))}
 placeholder="nomic-embed-text"
 searchPlaceholder={t("Cerca modello embedding...","Search embedding model...","Rechercher...","Buscar...","Suchen...")}
 emptyText={embeddingModelOptions.length === 0
 ? t("Premi AGGIORNA per recuperare i modelli","Press REFRESH to fetch models","Cliquez ACTUALISER","Pulsa ACTUALIZAR","REFRESH drücken")
 : t("Nessun risultato","No results","Aucun résultat","Sin resultados","Keine Treffer")}
 loading={embeddingModelsLoading}
 onRefresh={() => { void fetchEmbeddingModels(); }}
 refreshLabel={t("AGGIORNA","REFRESH","ACTUALISER","ACTUALIZAR","AKTUALISIEREN")}
 allowCustom
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">API key</Label>
 <Input
 type="password"
 value={kbDefaultsDraft.embeddingApiKey}
 onChange={(e) => { setKbEmbeddingKeyDirty(true); setKbDefaultsDraft((p) => ({ ...p, embeddingApiKey: e.target.value })); }}
 placeholder={!kbEmbeddingKeyDirty && kbDefaultsDraft.embeddingHasApiKey ? t("Salvata (nascosta)","Saved (hidden)","Enregistrée (masquée)","Guardada (oculta)","Gespeichert (verborgen)") :"sk-..."}
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="embedding-concurrency" className="text-xs uppercase tracking-wider text-muted-foreground/80">
 {t("Parallelismo","Parallelism","Parallélisme","Paralelismo","Parallelität")}
 </Label>
 <Input
 id="embedding-concurrency"
 type="number"
 min={1}
 max={16}
 value={kbDefaultsDraft.embeddingConcurrency}
 onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, embeddingConcurrency: e.target.value }))}
 placeholder="1"
 className="max-w-[6rem]"
 />
 <p className="text-[11px] text-muted-foreground/70">
 {t(
"Quante richieste di embedding lanciare in parallelo per export. 1 = una sola batch (default).",
"How many embedding requests to fan out in parallel per export. 1 = single batch (default).",
"Combien de requêtes d'embedding lancer en parallèle par export. 1 = une seule batch (défaut).",
"Cuántas solicitudes de embedding en paralelo por export. 1 = un solo batch (por defecto).",
"Wie viele Embedding-Anfragen parallel pro Export. 1 = eine einzelne Batch (Standard).",
 )}
 </p>
 </div>
 </div>
 </SettingsSection>

 <SettingsSection title={t("Chunking","Chunking","Découpage","Fragmentación","Chunking")}>
 <div className="space-y-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Strategia","Strategy","Stratégie","Estrategia","Strategie")}</Label>
 <Select value={kbDefaultsDraft.chunkingStrategy} onValueChange={(value) => setKbDefaultsDraft((p) => ({ ...p, chunkingStrategy: value as KbChunkingStrategy }))}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="fixed">{t("Lunghezza fissa","Fixed length","Longueur fixe","Longitud fija","Feste Länge")}</SelectItem>
 <SelectItem value="sentence">{t("Per frase","Per sentence","Par phrase","Por frase","Pro Satz")}</SelectItem>
 <SelectItem value="paragraph">{t("Per paragrafo","Per paragraph","Par paragraphe","Por párrafo","Pro Absatz")}</SelectItem>
 <SelectItem value="hierarchical">{t("Gerarchico (titoli)","Hierarchical (headings)","Hiérarchique (titres)","Jerárquico (títulos)","Hierarchisch (Überschriften)")}</SelectItem>
 <SelectItem value="semantic">{t("Semantico (embedding)","Semantic (embedding)","Sémantique (embedding)","Semántico (embedding)","Semantisch (Embedding)")}</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="grid grid-cols-3 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Max","Max","Max","Máx","Max")}</Label>
 <Input type="number"min={1} max={10000} value={kbDefaultsDraft.chunkingMaxSize} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingMaxSize: e.target.value }))} placeholder="1200"/>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 {t("Overlap","Overlap","Chevauchement","Solapamiento","Überlappung")}
 <HintInfo text={t(
"Caratteri ripetuti tra un chunk e il successivo: aiuta a non spezzare le idee a metà. Solo per la strategia 'lunghezza fissa'.",
"Characters repeated between adjacent chunks so ideas don't get sliced in half. Only meaningful for the fixed-length strategy.",
"Caractères répétés entre deux chunks adjacents pour ne pas couper une idée en deux. Utile uniquement avec la stratégie « longueur fixe ».",
"Caracteres compartidos entre fragmentos contiguos para no cortar ideas a la mitad. Solo aplica a la estrategia de longitud fija.",
"Zeichen, die zwischen Nachbar-Chunks geteilt werden, damit kein Gedanke abreißt. Nur bei fester Länge sinnvoll.",
)}/>
 </span>
 </Label>
 <Input type="number"min={0} value={kbDefaultsDraft.chunkingOverlap} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingOverlap: e.target.value }))} disabled={kbDefaultsDraft.chunkingStrategy !=="fixed"} placeholder="100"/>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 Min
 <HintInfo text={t(
"Lunghezza minima di un chunk: i frammenti più corti vengono uniti al successivo. Vale per tutte le strategie tranne 'lunghezza fissa'.",
"Minimum chunk length: anything shorter gets glued onto the next one. Applies to every strategy except fixed-length.",
"Longueur minimale d'un chunk : tout fragment plus court est fusionné avec le suivant. S'applique à toutes les stratégies sauf longueur fixe.",
"Longitud mínima del fragmento: si es menor se fusiona con el siguiente. Aplica a todas las estrategias excepto longitud fija.",
"Mindestlänge eines Chunks: Kürzere werden an den nächsten angehängt. Gilt für alle Strategien außer fester Länge.",
)}/>
 </span>
 </Label>
 <Input type="number"min={0} value={kbDefaultsDraft.chunkingMinSize} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingMinSize: e.target.value }))} disabled={kbDefaultsDraft.chunkingStrategy ==="fixed"} placeholder="200"/>
 </div>
 </div>
 {kbDefaultsDraft.chunkingStrategy === "semantic" ? (
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 {t("Soglia (percentile)","Threshold (percentile)","Seuil (percentile)","Umbral (percentil)","Schwelle (Perzentil)")}
 <HintInfo text={t(
"Distanze tra embedding di frasi consecutive sopra questo percentile diventano confini di chunk. Più alto = chunk meno numerosi e più grandi. Default 95.",
"Cosine distances between consecutive sentence embeddings above this percentile become chunk boundaries. Higher = fewer, larger chunks. Default 95.",
"Les distances cosinus entre embeddings de phrases consécutives au-dessus de ce percentile deviennent des frontières de chunk. Plus haut = chunks plus rares et plus gros. Défaut 95.",
"Las distancias coseno entre embeddings de frases consecutivas por encima de este percentil se convierten en límites de fragmento. Más alto = menos fragmentos y más grandes. Por defecto 95.",
"Kosinus-Distanzen zwischen aufeinanderfolgenden Satz-Embeddings über diesem Perzentil werden zu Chunk-Grenzen. Höher = weniger, größere Chunks. Standard 95.",
)}/>
 </span>
 </Label>
 <Input type="number"min={0} max={100} step={1} value={kbDefaultsDraft.chunkingBreakpointPercentile} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingBreakpointPercentile: e.target.value }))} placeholder="95"/>
 </div>
 ) : null}
 {kbDefaultsDraft.chunkingStrategy === "hierarchical" ? (
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 {t("Profondità titoli","Heading depth","Profondeur titres","Profundidad titulares","Überschriftentiefe")}
 <HintInfo text={t(
"Massimo livello di titolo Markdown (H1..H6) trattato come confine di sezione. Titoli più profondi vengono inclusi nel corpo del genitore. Default 6.",
"Maximum Markdown heading level (H1..H6) treated as a section boundary. Deeper headings get folded into the parent's body. Default 6.",
"Niveau de titre Markdown maximum (H1..H6) traité comme frontière de section. Les titres plus profonds sont fusionnés dans le corps du parent. Défaut 6.",
"Nivel máximo de título Markdown (H1..H6) tratado como frontera de sección. Los titulares más profundos se incluyen en el cuerpo del padre. Por defecto 6.",
"Maximale Markdown-Überschriftenebene (H1..H6), die als Abschnittsgrenze gilt. Tiefere Überschriften werden in den Inhalt der Eltern integriert. Standard 6.",
)}/>
 </span>
 </Label>
 <Input type="number"min={1} max={6} step={1} value={kbDefaultsDraft.chunkingMaxHeadingDepth} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingMaxHeadingDepth: e.target.value }))} placeholder="6"/>
 </div>
 ) : null}
 </div>
 </SettingsSection>

 <SettingsSection title={t("Vector store","Vector store","Vector store","Vector store","Vektor-Store")}>
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Tipo","Kind","Type","Tipo","Typ")}</Label>
 <Select
 value={kbDefaultsDraft.storeKind}
 onValueChange={(value) => {
 const nextKind = value as KbStoreKind;
 setStoreTestResult(null);
 setKbDefaultsDraft((p) => ({
 ...p,
 storeKind: nextKind,
 storeBaseUrl: p.storeBaseUrl === STORE_DEFAULT_BASE_URLS[p.storeKind] ? STORE_DEFAULT_BASE_URLS[nextKind] : p.storeBaseUrl,
 }));
 }}
 >
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="chroma">Chroma</SelectItem>
 <SelectItem value="qdrant">Qdrant</SelectItem>
 <SelectItem value="weaviate">Weaviate</SelectItem>
 <SelectItem value="milvus">Milvus</SelectItem>
 <SelectItem value="opensearch">OpenSearch</SelectItem>
 <SelectItem value="pinecone">Pinecone</SelectItem>
 <SelectItem value="typesense">Typesense</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Dimensioni","Dimensions","Dimensions","Dimensiones","Dimensionen")}</Label>
 <Input type="number"min={1} max={32768} value={kbDefaultsDraft.storeDimensions} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, storeDimensions: e.target.value }))} placeholder="768"/>
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Base URL</Label>
 <Input
 value={kbDefaultsDraft.storeBaseUrl}
 onChange={(e) => { setStoreTestResult(null); setKbDefaultsDraft((p) => ({ ...p, storeBaseUrl: e.target.value })); }}
 placeholder={kbDefaultsDraft.storeKind ==="pinecone"?"https://your-index-PROJECT.svc.REGION.pinecone.io": STORE_DEFAULT_BASE_URLS[kbDefaultsDraft.storeKind]}
 />
 <p className="text-[11px] text-muted-foreground/70">
 {kbDefaultsDraft.storeKind === "pinecone"
 ? t(
"Pinecone richiede l'host specifico del tuo indice (sostituisci INDEX, PROJECT, REGION).",
"Pinecone needs the per-index host URL (replace INDEX, PROJECT, REGION).",
"Pinecone exige l'URL d'hôte de l'index (remplace INDEX, PROJECT, REGION).",
"Pinecone requiere la URL del host del índice (sustituye INDEX, PROJECT, REGION).",
"Pinecone braucht die index-spezifische Host-URL (ersetze INDEX, PROJECT, REGION).",
 )
 : t(
 `Default per ${STORE_LABELS[kbDefaultsDraft.storeKind]}: ${STORE_DEFAULT_BASE_URLS[kbDefaultsDraft.storeKind]}`,
 `${STORE_LABELS[kbDefaultsDraft.storeKind]} default: ${STORE_DEFAULT_BASE_URLS[kbDefaultsDraft.storeKind]}`,
 `${STORE_LABELS[kbDefaultsDraft.storeKind]} par défaut : ${STORE_DEFAULT_BASE_URLS[kbDefaultsDraft.storeKind]}`,
 `${STORE_LABELS[kbDefaultsDraft.storeKind]} por defecto: ${STORE_DEFAULT_BASE_URLS[kbDefaultsDraft.storeKind]}`,
 `${STORE_LABELS[kbDefaultsDraft.storeKind]} Standard: ${STORE_DEFAULT_BASE_URLS[kbDefaultsDraft.storeKind]}`,
 )}
 </p>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">API key</Label>
 <Input
 type="password"
 value={kbDefaultsDraft.storeApiKey}
 onChange={(e) => { setKbStoreKeyDirty(true); setStoreTestResult(null); setKbDefaultsDraft((p) => ({ ...p, storeApiKey: e.target.value })); }}
 placeholder={!kbStoreKeyDirty && kbDefaultsDraft.storeHasApiKey ? t("Salvata (nascosta)","Saved (hidden)","Enregistrée (masquée)","Guardada (oculta)","Gespeichert (verborgen)") :""}
 />
 </div>
 <div className="flex items-center gap-3">
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={testStoreConnection}
 disabled={isTestingStore || !kbDefaultsDraft.storeBaseUrl.trim()}
 >
 {isTestingStore ? <LoaderCircleIcon size={14} className="inline-flex items-center justify-center mr-1.5 animate-spin"/> : null}
 {t("Prova connessione","Test connection","Tester la connexion","Probar conexión","Verbindung testen")}
 </Button>
 {storeTestResult && (
 <span
 role="status"
 aria-live="polite"
 aria-atomic="true"
 className={`text-[11px] ${storeTestResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
 >
 <span aria-hidden="true">{storeTestResult.ok ? "✓ " : "✗ "}</span>
 <span className="sr-only">
 {storeTestResult.ok
 ? t("Successo:","Success:","Succès:","Éxito:","Erfolg:")
 : t("Errore:","Error:","Erreur:","Error:","Fehler:")}{" "}
 </span>
 {storeTestResult.ok
 ? `${storeTestResult.version ? `v${storeTestResult.version} · ` : ""}${storeTestResult.latencyMs}ms`
 : storeTestResult.error || "failed"}
 </span>
 )}
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 {t("Nome collezione","Collection name","Nom collection","Nombre colección","Sammlungsname")}
 <HintInfo text={t(
"Il nome con cui finisce nel vector store. Puoi usare i segnaposti {jobId} e {fileName}: verranno sostituiti per ogni esportazione.",
"The name your chunks land under in the vector store. Use {jobId} or {fileName} as placeholders: they're filled in for every export.",
"Le nom utilisé dans le vector store. Utilisez les placeholders {jobId} et {fileName}: ils sont remplacés à chaque export.",
"El nombre que se usa en el vector store. Puedes usar los marcadores {jobId} y {fileName}: se sustituyen en cada exportación.",
"Der Name im Vektor-Store. Nutze {jobId} oder {fileName} als Platzhalter: sie werden bei jedem Export ersetzt.",
)}/>
 </span>
 </Label>
 <Input value={kbDefaultsDraft.collectionTemplate} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, collectionTemplate: e.target.value }))} placeholder="extracto-{jobId}"/>
 </div>
 </div>
 </SettingsSection>

 <div className="flex justify-end pt-2">
 <Button onClick={saveKbDefaults} disabled={isSavingKbDefaults}>
 {isSavingKbDefaults ? <LoaderCircleIcon size={16} className="inline-flex items-center justify-center mr-1.5 animate-spin"/> : null}
 {t("Salva knowledge base","Save knowledge base","Enregistrer KB","Guardar KB","KB speichern")}
 </Button>
 </div>
 </TabsContent>

 <TabsContent value="provider"className="space-y-5 mt-4">
 <SettingsSection title={t("Provider","Provider","Fournisseur","Proveedor","Anbieter")} hint={t(
"Chi esegue il modello: Ollama in locale per la massima privacy, Mistral o OpenRouter per più potenza, o un endpoint compatibile OpenAI tuo.",
"Where the model actually runs: Ollama on your machine for full privacy, Mistral or OpenRouter for raw horsepower, or any OpenAI-compatible endpoint you trust.",
"Qui exécute le modèle : Ollama en local pour la confidentialité, Mistral ou OpenRouter pour la puissance, ou un endpoint compatible OpenAI de votre choix.",
"Quién ejecuta el modelo: Ollama en local para máxima privacidad, Mistral o OpenRouter para más potencia, o un endpoint compatible OpenAI.",
"Wer das Modell ausführt: Ollama lokal für volle Privatsphäre, Mistral oder OpenRouter für Performance, oder ein eigener OpenAI-kompatibler Endpoint.",
)}>
 <Select value={apiSettingsDraft.provider} onValueChange={(value) => setApiSettingsDraft((prev) => { const nextProvider = normalizeProvider(value); return { ...prev, provider: nextProvider, apiEndpoint: defaultEndpointForProvider(nextProvider) }; })}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="ollama">Ollama</SelectItem>
 <SelectItem value="mistral">Mistral OCR API</SelectItem>
 <SelectItem value="openrouter">OpenRouter</SelectItem>
 <SelectItem value="openai_compat">OpenAI-compatible</SelectItem>
 </SelectContent>
 </Select>
 </SettingsSection>

 <SettingsSection title={t("Endpoint","Endpoint","Endpoint","Endpoint","Endpoint")}>
 <Input value={apiSettingsDraft.apiEndpoint} onChange={(event) => setApiSettingsDraft((prev) => ({ ...prev, apiEndpoint: event.target.value }))} placeholder={defaultEndpointForProvider(normalizeProvider(apiSettingsDraft.provider))}/>
 </SettingsSection>

 <SettingsSection
 title="API key"
 hint={!apiKeyDirty && apiSettingsDraft.hasApiKey ? t("Lascia invariata per mantenere la chiave corrente.","Leave unchanged to keep the current key.","Laissez tel quel pour conserver la clé.","Déjala igual para mantener la clave.","Unverändert lassen, um den aktuellen Schlüssel zu behalten.") : undefined}
 >
 <Input
 type="password"
 value={apiSettingsDraft.apiKey}
 onChange={(event) => setApiSettingsDraft((prev) => { setApiKeyDirty(true); return { ...prev, apiKey: event.target.value }; })}
 placeholder={!apiKeyDirty && apiSettingsDraft.hasApiKey ? t("Salvata (nascosta)","Saved (hidden)","Enregistrée (masquée)","Guardada (oculta)","Gespeichert (verborgen)") :"sk-..."}
 />
 </SettingsSection>

 <div className="flex justify-end pt-2">
 <Button onClick={saveApiSettings} disabled={isSavingApiSettings}>
 {isSavingApiSettings ? <LoaderCircleIcon size={16} className="inline-flex items-center justify-center mr-1.5 animate-spin"/> : null}
 {t("Salva provider","Save provider","Enregistrer le fournisseur","Guardar proveedor","Provider speichern")}
 </Button>
 </div>
 </TabsContent>

 <TabsContent value="general"className="space-y-5 mt-4">
 <SettingsSection title={t("Lingua interfaccia","Interface language","Langue d'interface","Idioma de la interfaz","Oberflächensprache")}>
 <Select value={uiLanguage} onValueChange={(value) => setUiLanguage(value as UiLanguage)}>
 <SelectTrigger className="w-full">
 <SelectValue>
 <span className="inline-flex items-center gap-2">
 <span aria-hidden>{UI_LANGUAGE_FLAGS[uiLanguage]}</span>
 <span>{UI_LANGUAGE_LABELS[uiLanguage]}</span>
 </span>
 </SelectValue>
 </SelectTrigger>
 <SelectContent>
 {UI_LANGUAGES.map((lang) => (
 <SelectItem key={lang} value={lang}>
 <span className="inline-flex items-center gap-2">
 <span aria-hidden>{UI_LANGUAGE_FLAGS[lang]}</span>
 <span>{UI_LANGUAGE_LABELS[lang]}</span>
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </SettingsSection>

 </TabsContent>

 <TabsContent value="keys"className="space-y-5 mt-4">
 <ApiKeysSection t={t} />
 </TabsContent>

 <TabsContent value="s3"className="space-y-8 mt-4">
 <S3SettingsSection t={t} />
 <div className="hairline-t pt-6"><WatchersSection t={t} /></div>
 </TabsContent>

 <TabsContent value="templates"className="space-y-5 mt-4">
 <TemplatesSection t={t} />
 </TabsContent>

 <TabsContent value="notifications"className="space-y-8 mt-4">
 <NotificationsSection t={t} />
 <div className="hairline-t pt-6"><UsageSection t={t} /></div>
 </TabsContent>

 </ScrollArea>
 </Tabs>

 <DialogFooter className="px-6 py-4 hairline-t">
 <Button variant="outline"onClick={() => { setApiSettingsOpen(false); setApiSettingsDraft(apiSettings); setApiKeyDirty(false); setKbDefaultsDraft(kbDefaults); setKbEmbeddingKeyDirty(false); setKbStoreKeyDirty(false); }}>
 {t("Chiudi","Done","Fermer","Cerrar","Schließen")}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={(open) => {
          setHistoryOpen(open);
          if (!open) history.resetSelection();
        }}
        t={t}
        jobs={history.jobs}
        isLoadingJobs={history.isLoadingJobs}
        selectedJobId={history.selectedId}
        onSelectJobId={history.setSelectedId}
        selectedJobDetail={history.selectedJob}
        isLoadingDetail={history.isLoadingDetail}
        selectedMarkdown={history.selectedMarkdown}
        selectedStructuredJson={history.selectedStructuredJson}
        isDeleting={history.isDeleting}
        onDelete={history.deleteSelected}
        onDownload={downloadHistoryResult}
        onBulkDelete={history.deleteMany}
        onBulkExport={history.exportManyAsZip}
      />

 {/* Main Content */}
 <main className="flex-1 min-h-0 overflow-y-auto custom-scroll lg:overflow-hidden container mx-auto px-3 py-4 sm:px-5 sm:py-6">
 <div className="grid gap-4 sm:gap-6 min-h-0 lg:h-full md:grid-cols-[minmax(320px,380px)_1fr] xl:grid-cols-[420px_1fr]">
 {/* Left Panel - File Upload & List */}
 <motion.div
 initial={{ x: -20, opacity: 0 }}
 animate={{ x: 0, opacity: 1 }}
 transition={{ duration: 0.4, delay: 0.1 }}
 className="flex flex-col gap-4 min-h-0 md:overflow-y-auto md:custom-scroll md:pr-1">
            {/* Upload Area */}
            <UploadArea
              isDragOver={isDragOver}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPickFiles={handleFiles}
              t={t}
            />

            <FileListCard
              files={files}
              selectedFileId={selectedFileId}
              onSelectFile={setSelectedFileId}
              onRemoveFile={removeFile}
              onClearAll={clearAllFiles}
              completedCount={completedCount}
              errorCount={errorCount}
              bulkSelectedIds={bulkSelectedIds}
              onToggleBulk={toggleBulkSelected}
              onClearBulk={() => setBulkSelectedIds(new Set())}
              onBulkRemove={removeBulkSelected}
              onBulkRun={() => { void processFiles(bulkSelectedIds); }}
              bulkRunReady={Boolean(selectedModel.trim()) && isRunReady}
              bulkRunPendingCount={files.filter((f) => bulkSelectedIds.has(f.id) && f.status === "pending").length}
              t={t}
              uiLanguage={uiLanguage}
              footer={
                <div className="p-3 space-y-2 bg-card">
                  {activeProcessingFile ? (
                    <Button
                      variant="destructive"
                      className="w-full group"
                      onClick={() => stopProcessingFile(activeProcessingFile)}
                    >
                      <PauseIcon
                        size={16}
                        className="inline-flex items-center justify-center mr-2 transition-transform duration-200 group-hover:scale-110"
                      />
                      {t("Ferma OCR corrente", "Stop current OCR", "Arrêter l'OCR en cours", "Detener OCR actual", "Aktuelle OCR stoppen")}
                    </Button>
                  ) : (
                    <Button
                      className="w-full group"
                      onClick={() => { void processFiles(); }}
                      disabled={isProcessing || pendingCount === 0 || !selectedModel.trim() || !isRunReady}
                    >
                      {isProcessing ? (
                        <>
                          <LoaderCircleIcon
                            size={16}
                            className="inline-flex items-center justify-center mr-2 animate-spin"
                          />
                          {t("Avvio in corso...", "Starting...", "Démarrage...", "Iniciando...", "Wird gestartet...")}
                        </>
                      ) : (
                        <>
                          <ZapIcon
                            size={16}
                            className="inline-flex items-center justify-center mr-2 transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6"
                          />
                          {t(
                            `Avvia OCR (${pendingCount} in attesa)`,
                            `Run OCR (${pendingCount} pending)`,
                            `Lancer OCR (${pendingCount} en attente)`,
                            `Iniciar OCR (${pendingCount} pendientes)`,
                            `OCR starten (${pendingCount} ausstehend)`,
                          )}
                        </>
                      )}
                    </Button>
                  )}
                  {resumableSelectedFile && !activeProcessingFile ? (
                    <Button
                      variant="secondary"
                      className="w-full group"
                      onClick={() => resumeProcessingFile(resumableSelectedFile)}
                    >
                      <PlayIcon
                        size={16}
                        className="inline-flex items-center justify-center mr-2 text-[oklch(0.62_0.13_150)] transition-transform duration-200 group-hover:scale-110"
                      />
                      {t(
                        "Riprendi dal checkpoint",
                        "Resume from checkpoint",
                        "Reprendre depuis le checkpoint",
                        "Reanudar desde checkpoint",
                        "Vom Checkpoint fortsetzen",
                      )}
                    </Button>
                  ) : null}
                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground min-w-0">
                    <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
                      <span className="text-muted-foreground/70 shrink-0">
                        {t("Modello", "Model", "Modèle", "Modelo", "Modell")}
                      </span>
                      <span className="text-foreground/90 font-medium tabular truncate min-w-0">
                        {models.find((m) => m.id === selectedModel)?.name || selectedModel || "none"}
                      </span>
                    </div>
                    {canExportZip ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={exportAllAsZip}
                            className="inline-flex items-center gap-1 text-foreground/70 hover:text-primary transition-colors shrink-0"
                          >
                            <ArchiveIcon size={12} className="inline-flex items-center justify-center" />
                            <span>ZIP</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t(
                            "Esporta tutti i risultati",
                            "Export all results",
                            "Exporter tous les résultats",
                            "Exportar todos los resultados",
                            "Alle Ergebnisse exportieren",
                          )}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
              }
            />

 <Collapsible defaultOpen={false}>
 <Card>
 <CollapsibleTrigger asChild>
 <button type="button"className="group w-full flex items-center justify-between gap-2 px-4 py-3 text-left rounded-2xl">
 <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
 <SettingsIcon size={14} className="inline-flex items-center justify-center text-foreground/70"/>
 {t("Opzioni avanzate","Advanced options","Options avancées","Opciones avanzadas","Erweiterte Optionen")}
 </span>
 <ChevronDownIcon size={14} className="inline-flex items-center justify-center text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180"/>
 </button>
 </CollapsibleTrigger>
 <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
 <CardContent className="space-y-4 pb-4">
 <div className="space-y-1.5">
 <Label className="text-[11px] uppercase tracking-wider text-muted-foreground/80">{t("Lingua documento","Document language","Langue","Idioma","Sprache")}</Label>
 <Select value={settings.language} onValueChange={(v) => setSettings((s) => ({ ...s, language: v }))}>
 <SelectTrigger className="w-full h-9 text-xs"><SelectValue /></SelectTrigger>
 <SelectContent>
 {LANGUAGES.map((lang) => (
 <SelectItem key={lang.code} value={lang.code}>{lang.names[uiLanguage] ?? lang.names.en}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 <div className="space-y-1.5">
 <div className="flex items-center justify-between">
 <Label className="text-[11px] uppercase tracking-wider text-muted-foreground/80">{t("Qualità","Quality","Qualité","Calidad","Qualität")}</Label>
 <span className="text-[11px] text-muted-foreground tabular">{settings.quality}%</span>
 </div>
 <Slider value={[settings.quality]} onValueChange={([v]) => setSettings((s) => ({ ...s, quality: v }))} min={50} max={100} step={10} className="py-1.5"/>
 </div>

 <div className="space-y-1.5">
 <Label className="text-[11px] uppercase tracking-wider text-muted-foreground/80">{t("Tipo documento","Document type","Type de document","Tipo de documento","Dokumenttyp")}</Label>
 <Select value={settings.documentPreset} onValueChange={(v) => setSettings((s) => ({ ...s, documentPreset: v as typeof s.documentPreset }))}>
 <SelectTrigger className="w-full h-9 text-xs"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="generic">{t("Generico","Generic","Générique","Genérico","Allgemein")}</SelectItem>
 <SelectItem value="academic">{t("Articolo accademico","Academic paper","Article scientifique","Artículo académico","Wissenschaftlicher Artikel")}</SelectItem>
 <SelectItem value="invoice">{t("Fattura / ricevuta","Invoice / receipt","Facture / reçu","Factura / recibo","Rechnung / Beleg")}</SelectItem>
 <SelectItem value="contract">{t("Contratto","Contract","Contrat","Contrato","Vertrag")}</SelectItem>
 <SelectItem value="form">{t("Modulo","Form","Formulaire","Formulario","Formular")}</SelectItem>
 </SelectContent>
 </Select>
 </div>

 <div className="space-y-1.5">
 <Label className="text-[11px] uppercase tracking-wider text-muted-foreground/80">{t("Istruzioni","Instructions","Instructions","Instrucciones","Anweisungen")}</Label>
 <Textarea
 placeholder={t("Esempio: ignora intestazioni e piè di pagina.","Example: ignore headers and footers.","Exemple : ignore en-têtes et pieds de page.","Ejemplo: ignora encabezados y pies.","Beispiel: Kopf- und Fußzeilen ignorieren.")}
 value={settings.customPrompt}
 onChange={(e) => setSettings((s) => ({ ...s, customPrompt: e.target.value }))}
 className="min-h-[60px] text-xs"/>
 </div>

 <div className="space-y-2 surface-soft rounded-xl px-3.5 py-3">
 <div className="flex items-center justify-between gap-2">
 <Label className="text-sm font-medium">{t("Post-processing","Post-processing","Post-traitement","Post-procesamiento","Nachverarbeitung")}</Label>
 <Switch checked={postProcessing.enabled} onCheckedChange={(enabled) => setPostProcessing((prev) => ({ ...prev, enabled }))} />
 </div>
 {postProcessing.enabled ? (
 <div className="space-y-2">
 <Textarea
 placeholder={t("Es: estrai numero fattura, scadenza, totali. Restituisci una tabella.","Ex: extract invoice number, due date, totals. Return one table.","Ex : extraire numéro, échéance, totaux. Renvoyer un tableau.","Ej: número, vencimiento, totales. Devuelve una tabla.","Bsp.: Rechnungsnummer, Fälligkeit, Summen. Eine Tabelle zurückgeben.")}
 value={postProcessing.instruction}
 onChange={(e) => setPostProcessing((prev) => ({ ...prev, instruction: e.target.value }))}
 className="min-h-[60px] text-xs bg-card"/>
 <div className="grid grid-cols-2 gap-2">
 <Select value={postProcessModelValue} onValueChange={(value) => setPostProcessing((prev) => ({ ...prev, model: value ==="__same__"?"": value }))}>
 <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="__same__">{t("Stesso modello","Same model","Même modèle","Mismo modelo","Gleiches Modell")}</SelectItem>
 {!selectedPostProcessModelExists && postProcessing.model ? <SelectItem value={postProcessing.model}>{postProcessing.model}</SelectItem> : null}
 {models.map((m) => (<SelectItem key={`pp-side-${m.id}`} value={m.id}>{m.name}</SelectItem>))}
 </SelectContent>
 </Select>
 <Select value={postProcessing.outputFormat} onValueChange={(value: PostProcessOutputFormat) => setPostProcessing((prev) => ({ ...prev, outputFormat: value }))}>
 <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="markdown">Markdown</SelectItem>
 <SelectItem value="json">JSON</SelectItem>
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

 <button
 type="button"
 onClick={openHistoryModal}
 className="group flex items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-card text-left shadow-[var(--shadow-soft)] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] hover:-translate-y-px hover:shadow-[var(--shadow-lift)]"
 >
 <span className="inline-flex items-center gap-2.5">
 <span className="grid place-items-center size-9 text-primary">
 <HistoryIcon size={18} className="inline-flex items-center justify-center"/>
 </span>
 <span className="flex flex-col">
 <span className="text-sm font-semibold tracking-tight">{t("Cronologia","History","Historique","Historial","Verlauf")}</span>
 <span className="text-[11px] text-muted-foreground">{t("Sfoglia esecuzioni passate","Browse past runs","Parcourir les exécutions","Explorar ejecuciones","Vergangene Läufe")}</span>
 </span>
 </span>
 <ArrowRightIcon size={14} className="inline-flex items-center justify-center text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary"/>
 </button>

 </motion.div>

 {/* Right Panel - Preview */}
 <motion.div
 initial={{ x: 20, opacity: 0 }}
 animate={{ x: 0, opacity: 1 }}
 transition={{ duration: 0.4, delay: 0.2 }}
 className={cn("flex flex-col lg:min-h-0", selectedFile ?"min-h-[420px] md:min-h-[500px]":"min-h-0")}>
 {selectedFile ? (
 <Card className="flex-1 flex flex-col min-h-0">
 <CardContent className="flex-1 flex flex-col p-0 min-h-0">
                  <PreviewHeader
                    selectedFile={selectedFile}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    copied={copied}
                    onCopy={copyToClipboard}
                    onDownload={downloadResult}
                    onExportToKb={exportFileToKb}
                    onSendToS3={exportFileToS3}
                    t={t}
                  />

 {/* Content Area */}
 {selectedFile.status ==="completed"&& selectedFile.result ? (
 <div className="flex-1 flex min-h-0">
 {/* Document Preview */}
 {(viewMode ==="preview"|| viewMode ==="split") && (
 <div
 className={cn(
"flex flex-col min-h-0",
 viewMode ==="split"?"w-[58%]":"flex-1")}
 >
 <div className="px-3 py-2 bg-muted/30">
 <span className="text-xs font-medium text-muted-foreground">{t("Anteprima documento","Document Preview","Aperçu du document","Vista previa del documento","Dokumentvorschau")}</span>
 </div>
 <ScrollArea className="flex-1">
 <div className="p-4 flex items-center justify-center min-h-full">
 {selectedFile.preview ? (
 <motion.img
 initial={{ opacity: 0, scale: 0.95 }}
 animate={{ opacity: 1, scale: 1 }}
 src={selectedFile.preview}
 alt={selectedFile.name}
 className="max-w-full max-h-[78vh] object-contain rounded-md shadow-sm"/>
 ) : (
 <div className="flex flex-col items-center text-muted-foreground">
 <ImageOff className="h-12 w-12 mb-2"/>
 <p className="text-sm">{t("Anteprima non disponibile","No preview available","Aucun aperçu disponible","Vista previa no disponible","Keine Vorschau verfügbar")}</p>
 <p className="text-xs">{t("Impossibile generare l'anteprima","Preview could not be generated","Impossible de générer l'aperçu","No se pudo generar la vista previa","Vorschau konnte nicht erstellt werden")}</p>
 </div>
 )}
 </div>
 </ScrollArea>
 </div>
 )}

 {/* OCR Results */}
 {(viewMode ==="result"|| viewMode ==="split") && (
 <div
 className={cn(
"flex flex-col min-h-0",
 viewMode ==="split"?"w-[42%]":"flex-1")}
 >
 <Tabs defaultValue="markdown"className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
 <div className="px-3 pt-2">
 <TabsList className="h-8 w-full justify-start overflow-x-auto">
 <TabsTrigger value="markdown"className="text-xs gap-1.5 h-6 shrink-0 group">
 <FileTextIcon size={12} className="inline-flex items-center justify-center text-[oklch(0.62_0.13_150)] transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
 Markdown
 </TabsTrigger>
 <TabsTrigger value="markdown-raw"className="text-xs gap-1.5 h-6 shrink-0 group">
 <FileTextIcon size={12} className="inline-flex items-center justify-center text-accent-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
 {t("Markdown grezzo","Markdown raw","Markdown brut","Markdown sin procesar","Roh-Markdown")}
 </TabsTrigger>
 <TabsTrigger value="json"className="text-xs gap-1.5 h-6 shrink-0 group">
 <Code className="h-3 w-3 text-accent-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
 JSON
 </TabsTrigger>
 </TabsList>
 </div>

 <TabsContent value="markdown"className="flex-1 m-0 min-h-0 min-w-0">
 <ScrollArea className="h-full w-full">
 <div className="prose prose-sm dark:prose-invert max-w-none p-4 break-words [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:break-words">
 <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedFileMarkdown}</ReactMarkdown>
 </div>
 </ScrollArea>
 </TabsContent>

 <TabsContent value="markdown-raw"className="flex-1 m-0 min-h-0 min-w-0">
 <ScrollArea className="h-full w-full">
 <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
 {selectedFileMarkdown}
 </pre>
 </ScrollArea>
 </TabsContent>

 <TabsContent value="json"className="flex-1 m-0 min-h-0 min-w-0">
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
 ) : selectedFile.status ==="processing"|| selectedFile.status ==="paused"? (
 <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
 <div className="p-4 space-y-3">
 <div className="flex items-center justify-between gap-3">
 <div>
 <p className="text-sm font-medium">
 {selectedFile.status ==="paused"? t("OCR in pausa","OCR Paused","OCR en Pause","OCR en Pausa","OCR Pausiert") : t("OCR in elaborazione","Processing OCR","OCR en cours de traitement","Procesando OCR","OCR wird verarbeitet")}
 </p>
 <p className="text-xs text-muted-foreground">
 {translatePipelineMessage(selectedFile.stageMessage, uiLanguage) || t("Esecuzione pipeline di estrazione","Running extraction pipeline","Pipeline d'extraction en cours","Ejecutando pipeline de extracción","Extraktions-Pipeline läuft")}
 </p>
 </div>
 <Badge variant={selectedFile.status ==="paused"?"outline":"secondary"}>
 {selectedFile.status ==="paused"? t("in pausa","paused","en pause","en pausa","pausiert") : t("in esecuzione","running","en cours d'exécution","en ejecución","wird ausgeführt")}
 </Badge>
 </div>
 <Progress value={selectedFile.progress} className="w-full"/>
 <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
 <div className="flex items-center gap-1.5">
 <ClipboardCheckIcon size={14} className="inline-flex items-center justify-center"/>
 <span>
 {selectedFile.processedPages || 0}/{selectedFile.pageCount || 0} {t("pagine","pages","pages","páginas","Seiten")}
 </span>
 </div>
 <div className="flex items-center gap-1.5">
 <ClockIcon size={14} className="inline-flex items-center justify-center"/>
 <span>{t("ETA","ETA","ETA","ETA","ETA")} {formatEta(selectedFile.etaSeconds)}</span>
 </div>
 <div className="truncate">
 {models.find((m) => m.id === selectedModel)?.name || selectedModel}
 </div>
 </div>
 </div>
 <div className="grid md:grid-cols-[1fr_280px] flex-1 min-h-0 overflow-hidden">
 <div className="h-full min-h-0 overflow-y-auto scrollbar-hide">
 <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
 {(selectedFile.pagePreviews || []).map((preview, index) => {
 const pageNumber = index + 1;
 const processed =
 typeof selectedFile.processedPages ==="number"&&
 selectedFile.processedPages >= pageNumber;
 const checkpoint = selectedFile.checkpoints?.find(
 (item) => item.pageNumber === pageNumber
 );
 return (
 <div
 key={`${selectedFile.id}-page-${pageNumber}`}
 className={cn(
"rounded-md p-2 space-y-2",
 processed ?"bg-[color-mix(in_oklab,oklch(0.62_0.13_150),transparent_88%)]":"")}
 >
 <img
 src={preview}
 alt={`${selectedFile.name} ${t("pagina","page","page","página","Seite")} ${pageNumber}`}
 className="w-full h-24 object-cover rounded"/>
 <div className="flex items-center justify-between">
 <p className="text-[11px] font-medium">{t("Pagina","Page","Page","Página","Seite")} {pageNumber}</p>
 <Badge variant={processed ?"secondary":"outline"} className="text-[10px]">
 {processed ? t("fatto","done","fait","hecho","fertig") : t("in coda","queued","en file d'attente","en cola","in der Warteschlange")}
 </Badge>
 </div>
 <p className="text-[10px] text-muted-foreground line-clamp-3">
 {checkpoint?.previewText || t("In attesa di estrazione...","Waiting for extraction...","En attente de l'extraction...","Esperando extracción...","Warte auf Extraktion...")}
 </p>
 </div>
 );
 })}
 </div>
 </div>
 <div className="h-full min-h-0 overflow-y-auto scrollbar-hide">
 <div className="p-4 space-y-2">
 <p className="text-xs font-medium text-muted-foreground">
 {t("Attività modello in tempo reale","Live model activity","Activité du modèle en direct","Actividad del modelo en vivo","Live-Modellaktivität")}
 </p>
 {(selectedFile.events || []).length > 0 ? (
 [...(selectedFile.events || [])]
 .reverse()
 .slice(0, 18)
 .map((event, idx) => (
 <div
 key={`${event.at ||"event"}-${idx}`}
 className="surface-soft rounded-xl p-2">
 <p className="text-[11px] font-medium">
 {event.stage ||"stage"}
 </p>
 <p className="text-[11px] text-muted-foreground">
 {translatePipelineMessage(event.message, uiLanguage)}
 </p>
 <p className="text-[10px] text-muted-foreground">
 {event.at ? formatTimestamp(event.at) :""}
 </p>
 </div>
 ))
 ) : (
 <p className="text-xs text-muted-foreground">
 {t("In attesa di eventi di avanzamento...","Waiting for progress events...","En attente d'événements de progression...","Esperando eventos de progreso...","Warte auf Fortschrittsereignisse...")}
 </p>
 )}
 </div>
 </div>
 </div>
 </div>
 ) : selectedFile.status ==="error"? (
 <div className="flex-1 flex items-center justify-center">
 <motion.div
 initial={{ opacity: 0, scale: 0.9 }}
 animate={{ opacity: 1, scale: 1 }}
 className="text-center">
 <div className="mx-auto mb-4 flex items-center justify-center text-destructive">
 <AlertCircle className="h-10 w-10"/>
 </div>
 <p className="text-sm font-medium mb-1">{t("Elaborazione non riuscita","Processing Failed","Échec du traitement","Procesamiento fallido","Verarbeitung fehlgeschlagen")}</p>
 <p className="text-xs text-muted-foreground max-w-xs">
 {selectedFile.error || t("Si è verificato un errore durante l'elaborazione OCR","An error occurred during OCR processing","Une erreur est survenue pendant le traitement OCR","Ocurrió un error durante el procesamiento OCR","Beim OCR-Vorgang ist ein Fehler aufgetreten")}
 </p>
 </motion.div>
 </div>
 ) : (
 <div className="flex-1 flex flex-col min-h-0">
 {selectedFile.preview || allPagePreviews.length > 0 ? (
 <DocumentGallery
 pagePreviews={
 allPagePreviewsForFileId === selectedFile.id && allPagePreviews.length > 0
 ? allPagePreviews
 : selectedFile.preview
 ? [selectedFile.preview]
 : []
 }
 selected={
 Array.isArray(selectedFile.selectedPages)
 ? selectedFile.selectedPages
 : []
 }
 onChange={(next) =>
 updateFileById(selectedFile.id, (entry) => ({
 ...entry,
 selectedPages: next,
 }))
 }
 t={t}
 fileName={selectedFile.name}
 isLoading={isLoadingAllPagePreviews && allPagePreviewsForFileId !== selectedFile.id}
 />
 ) : (
 <motion.div
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 className="text-center m-auto">
 <div className="mx-auto mb-4 flex items-center justify-center text-muted-foreground/70">
 <ScanLine className="h-10 w-10"/>
 </div>
 <p className="text-sm font-medium mb-1">{t("Pronto per OCR","Ready for OCR","Prêt pour l'OCR","Listo para OCR","Bereit für OCR")}</p>
 <p className="text-xs text-muted-foreground">
 {t(
'Clicca "Avvia OCR" per estrarre il testo',
'Click "Run OCR" to extract text',
'Cliquez sur « Lancer l\'OCR » pour extraire le texte',
'Pulsa "Iniciar OCR" para extraer el texto',
'Klicke auf „OCR starten", um den Text zu extrahieren',
)}
 </p>
 </motion.div>
 )}
 </div>
 )}
 </CardContent>
 </Card>
 ) : (
 <NoSelectionCard t={t} />
 )}
 </motion.div>
 </div>
 </main>

 <Footer t={t} />
 </div>
 );
}

