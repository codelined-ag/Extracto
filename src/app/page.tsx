"use client";

import * as React from"react";
import { motion } from "motion/react";
import {
 Code,
 AlertCircle,
 ScanLine,
 ImageOff,
 Cloud,
 Layers,
 Plug,
 TrendingUp,
 ShieldCheck,
} from"lucide-react";

import { ArchiveIcon } from"@/components/ui/archive";
import { ArrowRightIcon } from"@/components/ui/arrow-right";
import { ChevronDownIcon } from"@/components/ui/chevron-down";
import { ClipboardCheckIcon } from"@/components/ui/clipboard-check";
import { ClockIcon } from"@/components/ui/clock";
import { DatabaseBackupIcon } from"@/components/ui/database-backup";
import { FileTextIcon } from"@/components/ui/file-text";
import { HistoryIcon } from"@/components/ui/history";
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
import { resolveTemplateInstruction } from"@/lib/ocr/post-processing-templates";
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
} from "@/app/page-components/settings-primitives";
import { FileListCard } from "@/app/page-components/file-list-card";
import { CostEstimate } from "@/app/page-components/cost-estimate";
import { Footer } from "@/app/page-components/footer";
import { HeaderBar } from "@/app/page-components/header-bar";
import { ChangePasswordDialog } from "@/app/page-components/change-password-dialog";
import { AccountDialog } from "@/app/page-components/account-dialog";
import { SettingsAccordion, SettingsAccordionItem, readPersistedOpen } from "@/app/page-components/settings-accordion";
import { isUiLanguage } from "@/app/page-components/ui-language";
import { MarkdownView } from "@/app/page-components/markdown-view";
import { OnboardingTour, useOnboardingTour } from "@/app/page-components/onboarding-tour";
import { SetupWizard, isSetupCompleted, markSetupCompleted } from "@/app/page-components/setup-wizard";
import { S3SettingsSection } from "@/app/page-components/s3-settings-section";
import { WatchersSection } from "@/app/page-components/watchers-section";
import { TemplatesSection } from "@/app/page-components/templates-section";
import { IntegrationsPanel } from "@/app/page-components/integrations-panel";
import { CloudExportDialog } from "@/app/page-components/cloud-export-dialog";
import { CloudImportDialog } from "@/app/page-components/cloud-import-dialog";
import { CompareDialog } from "@/app/page-components/compare-dialog";
import { RecommendationsDialog } from "@/app/page-components/recommendations-dialog";
import { JobExtrasPanel } from "@/app/page-components/job-extras-panel";
import { FieldHint, HintLabel } from "@/app/page-components/field-hint";
import { clearQueue, deletePagePreviews, loadAllPagePreviews, loadQueue, persistPagePreviews, persistQueue, reconcileJobFromServer } from "@/app/page-components/queue-persistence";
import { HistoryDialog } from "@/app/page-components/history-dialog";
import { useHistory } from "@/app/page-components/use-history";
import { useTags } from "@/app/page-components/use-tags";
import { useSavedSearches } from "@/app/page-components/use-saved-searches";
import { PreviewHeader } from "@/app/page-components/preview-header";
import { NoSelectionCard } from "@/app/page-components/no-selection-card";
import { DocumentGallery } from "@/app/page-components/document-gallery";
import { UploadArea } from "@/app/page-components/upload-area";
import {
  isClientOnline,
  isNetworkError,
  subscribeNetworkStatus,
} from "@/lib/offline/network-status";
import type {
  OcrPageCheckpointView,
  OcrProgressEventView,
  ProcessingFile,
  SettingsTab,
  UiLanguage,
  KbExportPhase,
} from "@/app/page-components/types";

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
 pdfJsLibPromise = import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<Record<string, unknown>>;
 }

 const pdfjsLib = await pdfJsLibPromise;
 const globalOptions = (pdfjsLib as { GlobalWorkerOptions?: { workerSrc?: string } }).GlobalWorkerOptions;
 if (globalOptions && !globalOptions.workerSrc) {
 globalOptions.workerSrc = "/pdf.worker.min.mjs";
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
 const getDocument = (pdfjsLib as { getDocument?: (input: { data: ArrayBuffer; disableWorker?: boolean }) => {
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
 const getDocument = (pdfjsLib as { getDocument?: (input: { data: ArrayBuffer; disableWorker?: boolean }) => {
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
 const pageCount = await getPdfPageCount(file).catch((err) => { console.error("[extracto] getPdfPageCount failed:", err); return undefined; });
 const previews = await renderPdfPagesAsImages(file, { pageLimit: 1, startPage: 1 });
 const firstPage = previews[0] ||"";
 return { preview: firstPage, pagePreviews: previews, pageCount };
 } catch (err) {
 console.error("[extracto] buildInitialPreview failed:", err);
 return { preview:""};
 }
}

// Main Component
export default function ExtractoPage() {
 const router = useRouter();
 const { toast } = useToast();
 const [files, setFiles] = React.useState<ProcessingFile[]>([]);
 const [isOnline, setIsOnline] = React.useState<boolean>(true);
 const filesRef = React.useRef<ProcessingFile[]>([]);
 React.useEffect(() => {
  filesRef.current = files;
 }, [files]);
 const [bulkSelectedIds, setBulkSelectedIds] = React.useState<Set<string>>(() => new Set());
 const [selectedModel, setSelectedModel] = React.useState<string>(OLLAMA_FALLBACK_MODELS[0].id);
 const [models, setModels] = React.useState<Model[]>(OLLAMA_FALLBACK_MODELS);
 const [apiSettings, setApiSettings] = React.useState<ApiSettingsForm>(DEFAULT_API_SETTINGS);
 const [apiSettingsDraft, setApiSettingsDraft] = React.useState<ApiSettingsForm>(DEFAULT_API_SETTINGS);
 const [apiKeyDirty, setApiKeyDirty] = React.useState(false);
 const [isDragOver, setIsDragOver] = React.useState(false);
 const [isProcessing, setIsProcessing] = React.useState(false);
 const isProcessingRef = React.useRef(false);
 const [uiLanguage, setUiLanguage] = React.useState<UiLanguage>("en");
 const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
 const [copied, setCopied] = React.useState<"md"|"json"| null>(null);
 const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);
 const [settingsTab, setSettingsTab] = React.useState<SettingsTab>("ocr");
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
 const [accountDialogOpen, setAccountDialogOpen] = React.useState(false);
 const [setupWizardOpen, setSetupWizardOpen] = React.useState(false);
 const [ocrAccordionOpen, setOcrAccordionOpen] = React.useState<string | null>(() => readPersistedOpen("extracto.settings.ocr.open", "provider"));
 const [modelError, setModelError] = React.useState("");
 const [historyOpen, setHistoryOpen] = React.useState(false);

 // Advanced settings state
 const ocrSettingsLoadedRef = React.useRef(false);
 const [ocrSettingsLoaded, setOcrSettingsLoaded] = React.useState(false);
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
 piiRedaction: false,
 });
 const [postProcessing, setPostProcessing] = React.useState<PostProcessingSettings>(() => {
 const fallback: PostProcessingSettings = {
   enabled: false,
   instruction: "",
   outputFormat: "markdown",
   model: "",
   template: "custom",
   targetLanguage: "",
 };
 if (typeof window === "undefined") return fallback;
 try {
   const raw = window.localStorage.getItem("extracto.postProcessing");
   if (!raw) return fallback;
   const parsed = JSON.parse(raw) as Partial<PostProcessingSettings>;
   return { ...fallback, ...parsed };
 } catch {
   return fallback;
 }
 });
 const [advancedOptionsOpen, setAdvancedOptionsOpen] = React.useState<boolean>(false);
 React.useEffect(() => {
   try {
     if (window.localStorage.getItem("extracto.advancedOpen") === "1") {
       setAdvancedOptionsOpen(true);
     }
   } catch { /* ignore */ }
 }, []);
 React.useEffect(() => {
   if (typeof window === "undefined") return;
   try {
     window.localStorage.setItem("extracto.postProcessing", JSON.stringify(postProcessing));
   } catch { /* ignore quota */ }
 }, [postProcessing]);
 React.useEffect(() => {
   if (typeof window === "undefined") return;
   try {
     window.localStorage.setItem("extracto.advancedOpen", advancedOptionsOpen ? "1" : "0");
   } catch { /* ignore quota */ }
 }, [advancedOptionsOpen]);

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
 ...payload.embeddings.map((id) => ({ value: id, label: id, hint: t("embedding","embedding","embedding","embedding","Embedding") })),
 ...payload.others.map((id) => ({ value: id, label: id })),
 ];
 setEmbeddingModelOptions(opts);
 } catch (error) {
 toast({
 title: t("Ricerca modelli fallita","Model discovery failed","Échec de la recherche de modèles","Falló la búsqueda de modelos","Modellsuche fehlgeschlagen"),
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
 const resolvedPostProcessInstruction = resolveTemplateInstruction({
 template: postProcessing.template,
 targetLanguage: postProcessing.targetLanguage,
 customInstruction: postProcessing.instruction,
 });
 const isPostProcessingReady =
 !postProcessing.enabled || resolvedPostProcessInstruction.length > 0;
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
 const tagState = useTags(t);
 const savedSearches = useSavedSearches(t);
 const historyApplyFilters = React.useCallback(
   (filters: Parameters<typeof history.loadJobs>[0]) => {
     void history.loadJobs(filters);
   },
   [history.loadJobs],
 );
 const { start: restartTour } = useOnboardingTour(t);
 const openSettingsTab = React.useCallback(
 (tab: SettingsTab) => {
 if (tab === "ocr") {
 setApiSettingsDraft(apiSettings);
 setApiKeyDirty(false);
 } else if (tab === "kb") {
 setKbDefaultsDraft(kbDefaults);
 setKbEmbeddingKeyDirty(false);
 setKbStoreKeyDirty(false);
 }
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
 setOcrSettingsLoaded(true);
 } catch (error) {
 ocrSettingsLoadedRef.current = true;
 setOcrSettingsLoaded(true);
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

 const saveApiSettingsDirect = async (next: { provider: ProviderKind; apiEndpoint: string; apiKey: string }) => {
 const response = await fetch("/api/settings", {
 method:"PUT",
 headers: {"Content-Type":"application/json"},
 body: JSON.stringify({
 provider: next.provider,
 apiEndpoint: next.apiEndpoint,
 apiKey: next.apiKey,
 hasApiKey: Boolean(next.apiKey),
 replaceApiKey: Boolean(next.apiKey),
 }),
 });
 if (!response.ok) {
 const payload = (await response.json().catch(() => ({}))) as { error?: string };
 throw new Error(payload.error || `Failed to save API settings (${response.status})`);
 }
 const saved = (await response.json()) as ApiSettingsForm;
 const provider = normalizeProvider(saved.provider);
 const normalized: ApiSettingsForm = {
 provider,
 apiEndpoint: saved.apiEndpoint?.trim() || defaultEndpointForProvider(provider),
 apiKey:"",
 hasApiKey: saved.hasApiKey === true,
 };
 setApiSettings(normalized);
 setApiSettingsDraft(normalized);
 setApiKeyDirty(false);
 await fetchAvailableModels(normalized);
 };

 React.useEffect(() => {
 if (typeof window === "undefined") return;
 if (!ocrSettingsLoaded) return;
 if (isSetupCompleted()) return;
 if (apiSettings.hasApiKey) {
 markSetupCompleted();
 return;
 }
 const timer = window.setTimeout(() => setSetupWizardOpen(true), 200);
 return () => window.clearTimeout(timer);
 }, [ocrSettingsLoaded, apiSettings.hasApiKey]);

 React.useEffect(() => {
 if (setupWizardOpen && apiSettings.hasApiKey) {
 setSetupWizardOpen(false);
 markSetupCompleted();
 }
 }, [setupWizardOpen, apiSettings.hasApiKey]);

 const openHistoryModal = async () => {
 setHistoryOpen(true);
 await history.loadJobs();
 };

 const downloadHistoryResult = async (type:"md"|"json"|"zip") => {
 if (!history.selectedJob) return;
 const fileStem = history.selectedJob.fileName.replace(/\.[^/.]+$/,"") ||"ocr-result";

 if (type === "zip") {
   const JSZip = (await import("jszip")).default;
   const zip = new JSZip();
   const structured = history.selectedStructuredJson as { pages?: Array<{ pageNumber?: number; markdown?: string; text?: string }> } | undefined;
   const structuredPages = structured?.pages;
   const pages: Array<{ pageNumber: number; markdown: string }> = [];
   if (Array.isArray(structuredPages) && structuredPages.length > 0) {
     for (const page of structuredPages) {
       const md = typeof page.markdown === "string" ? page.markdown : typeof page.text === "string" ? page.text : "";
       if (md.trim().length === 0) continue;
       pages.push({ pageNumber: typeof page.pageNumber === "number" ? page.pageNumber : pages.length + 1, markdown: md });
     }
   }
   if (pages.length === 0) pages.push({ pageNumber: 1, markdown: history.selectedMarkdown });

   const indexLines = [`# ${fileStem}`, "", `Pages: ${pages.length}`, ""];
   if (pages.length > 1) {
     indexLines.push("## Pages");
     for (const page of pages) {
       const padded = String(page.pageNumber).padStart(3, "0");
       indexLines.push(`- [Page ${page.pageNumber}](pages/page-${padded}.md)`);
     }
     indexLines.push("");
   }
   indexLines.push("All pages joined: [all-pages.md](all-pages.md)", "");
   zip.file(`${fileStem}/index.md`, indexLines.join("\n"));
   for (const page of pages) {
     const padded = String(page.pageNumber).padStart(3, "0");
     zip.file(`${fileStem}/pages/page-${padded}.md`, page.markdown.trim() + "\n");
   }
   zip.file(`${fileStem}/all-pages.md`, pages.map((p) => `## Page ${p.pageNumber}\n\n${p.markdown.trim()}\n`).join("\n"));

   const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
   const url = URL.createObjectURL(blob);
   const a = document.createElement("a");
   a.href = url;
   a.download = `${fileStem}-pages.zip`;
   a.click();
   URL.revokeObjectURL(url);
   return;
 }

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
 setPostProcessing((prev) => {
 if (prev.model && providerModelIds.includes(prev.model)) return prev;
 if (prev.model === nextModel) return prev;
 return { ...prev, model: nextModel };
 });
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
 if (!historyOpen) return;
 void tagState.loadTags();
 void savedSearches.load();
 }, [historyOpen, tagState.loadTags, savedSearches.load]);

 React.useEffect(() => {
 if (!ocrSettingsLoadedRef.current) return;
 const controller = new AbortController();
 const t = setTimeout(() => {
 void fetch("/api/ocr/settings", {
 method:"PUT",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify(settings),
 signal: controller.signal,
 }).catch(() => undefined);
 }, 1000);
 return () => {
 clearTimeout(t);
 controller.abort();
 };
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
 action: (
 <ToastAction
 altText={t("Configura KB","Configure KB","Configurer KB","Configurar KB","KB konfigurieren")}
 onClick={() => { openSettingsTab("kb"); }}
 >
 {t("Configura","Configure","Configurer","Configurar","Konfigurieren")}
 </ToastAction>
 ),
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
 action: (
 <ToastAction
 altText={t("Configura S3","Configure S3","Configurer S3","Configurar S3","S3 konfigurieren")}
 onClick={() => { openSettingsTab("storage"); }}
 >
 {t("Configura","Configure","Configurer","Configurar","Konfigurieren")}
 </ToastAction>
 ),
 });
 }
 };

 const [cloudConnected, setCloudConnected] = React.useState<{ dropbox: boolean; google_drive: boolean; onedrive: boolean }>({ dropbox: false, google_drive: false, onedrive: false });
 const [cloudImportOpen, setCloudImportOpen] = React.useState(false);
 const [compareOpen, setCompareOpen] = React.useState(false);
 const [recommendationsOpen, setRecommendationsOpen] = React.useState(false);

 React.useEffect(() => {
   let cancelled = false;
   void (async () => {
     try {
       const res = await fetch("/api/integrations");
       if (!res.ok) return;
       const json = (await res.json()) as { connections?: Array<{ provider: string }> };
       if (cancelled) return;
       const set = new Set((json.connections ?? []).map((c) => c.provider));
       setCloudConnected({
         dropbox: set.has("dropbox"),
         google_drive: set.has("google_drive"),
         onedrive: set.has("onedrive"),
       });
     } catch { /* ignore */ }
   })();
   return () => { cancelled = true; };
 }, [apiSettingsOpen]);

 const [cloudExportDialog, setCloudExportDialog] = React.useState<{
 open: boolean;
 provider: "dropbox" | "google_drive" | "onedrive";
 file: ProcessingFile | null;
 }>({ open: false, provider: "dropbox", file: null });

 const exportFileToCloud = (file: ProcessingFile, provider: "dropbox" | "google_drive" | "onedrive") => {
 if (!file.jobId) {
 toast({
 title: t("Nessun jobId","Missing jobId","jobId manquant","Falta jobId","jobId fehlt"),
 description: t(
"Solo i lavori OCR completati possono essere inviati.",
"Only completed OCR jobs can be sent.",
"Seuls les jobs OCR terminés peuvent être envoyés.",
"Solo se pueden enviar trabajos OCR completados.",
"Nur abgeschlossene OCR-Jobs können gesendet werden.",
 ),
 variant:"destructive",
 });
 return;
 }
 if (!cloudConnected[provider]) {
 toast({
 title: t(
 `${provider === "dropbox" ? "Dropbox" : provider === "google_drive" ? "Google Drive" : "OneDrive"} non connesso`,
 `${provider === "dropbox" ? "Dropbox" : provider === "google_drive" ? "Google Drive" : "OneDrive"} not connected`,
 ),
 description: t("Connetti l'account in Impostazioni → Integrazioni.","Connect the account from Settings → Integrations.","Connectez le compte dans Paramètres → Intégrations.","Conecta la cuenta en Ajustes → Integraciones.","Verbinde das Konto in Einstellungen → Integrationen."),
 variant:"destructive",
 action: (
 <ToastAction
 altText={t("Configura","Configure","Configurer","Configurar","Konfigurieren")}
 onClick={() => { openSettingsTab("integrations"); }}
 >
 {t("Configura","Configure","Configurer","Configurar","Konfigurieren")}
 </ToastAction>
 ),
 });
 return;
 }
 setCloudExportDialog({ open: true, provider, file });
 };

 const submitCloudExport = async (folder: string, format: string) => {
 const file = cloudExportDialog.file;
 const provider = cloudExportDialog.provider;
 if (!file?.jobId) return;
 try {
 const resp = await fetch(`/api/integrations/${provider}/push`, {
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify({ jobId: file.jobId, folder: folder.trim(), format: format.trim() }),
 });
 const payload = (await resp.json().catch(() => ({}))) as { error?: string; path?: string; size?: number };
 if (!resp.ok) throw new Error(payload.error || `HTTP ${resp.status}`);
 toast({
 title: t(`Inviato a ${provider === "dropbox" ? "Dropbox" : provider === "google_drive" ? "Google Drive" : "OneDrive"}`,`Sent to ${provider === "dropbox" ? "Dropbox" : provider === "google_drive" ? "Google Drive" : "OneDrive"}`),
 description: payload.path,
 });
 } catch (err) {
 toast({
 title: t("Invio fallito","Push failed","Échec de l'envoi","Error al enviar","Senden fehlgeschlagen"),
 description: err instanceof Error ? err.message : String(err),
 variant:"destructive",
 action: (
 <ToastAction
 altText={t("Configura","Configure","Configurer","Configurar","Konfigurieren")}
 onClick={() => { openSettingsTab("integrations"); }}
 >
 {t("Configura","Configure","Configurer","Configurar","Konfigurieren")}
 </ToastAction>
 ),
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
 const isAccepted = (file: File) => {
 const name = file.name.toLowerCase();
 if (file.type.startsWith("image/")) return true;
 if (file.type === "application/pdf") return true;
 if (file.type === "application/msword") return true;
 if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
 return /\.(pdf|png|jpg|jpeg|webp|gif|bmp|tiff?|heic|heif|doc|docx)$/i.test(name);
 };
 const collected = await collectDroppedFiles(e.dataTransfer.items);
 if (collected.length > 0) {
 const accepted = collected.filter(isAccepted);
 const rejected = collected.length - accepted.length;
 if (rejected > 0) {
 toast({ title: t("File ignorati", "Files ignored", "Fichiers ignorés", "Archivos ignorados", "Dateien ignoriert"), description: t(`${rejected} file non supportato(i) sono stati ignorati.`, `${rejected} unsupported file(s) were ignored.`, `${rejected} fichier(s) non pris en charge ont été ignorés.`, `${rejected} archivo(s) no admitidos fueron ignorados.`, `${rejected} nicht unterstützte Datei(en) wurden ignoriert.`) });
 }
 if (accepted.length > 0) {
 const dt = new DataTransfer();
 accepted.forEach((f) => dt.items.add(f));
 handleFiles(dt.files);
 }
 return;
 }
 const raw = Array.from(e.dataTransfer.files);
 const accepted = raw.filter(isAccepted);
 const rejected = raw.length - accepted.length;
 if (rejected > 0) {
 toast({ title: t("File ignorati", "Files ignored", "Fichiers ignorés", "Archivos ignorados", "Dateien ignoriert"), description: t(`${rejected} file non supportato(i) sono stati ignorati.`, `${rejected} unsupported file(s) were ignored.`, `${rejected} fichier(s) non pris en charge ont été ignorés.`, `${rejected} archivo(s) no admitidos fueron ignorados.`, `${rejected} nicht unterstützte Datei(en) wurden ignoriert.`) });
 }
 if (accepted.length > 0) {
 const dt = new DataTransfer();
 accepted.forEach((f) => dt.items.add(f));
 handleFiles(dt.files);
 }
 };

 const removeFile = (id: string) => {
 setFiles((prev) => {
 const remaining = prev.filter((f) => f.id !== id);
 if (selectedFileId === id) {
 setSelectedFileId(remaining[0]?.id || null);
 }
 return remaining;
 });
 setBulkSelectedIds((prev) => {
 if (!prev.has(id)) return prev;
 const next = new Set(prev);
 next.delete(id);
 return next;
 });
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

 const downloadResult = async (type:"md"|"json"|"zip") => {
 if (!selectedFile?.result) return;

 const stem = selectedFile.name.replace(/\.[^/.]+$/,"");

 if (type === "zip") {
   const JSZip = (await import("jszip")).default;
   const zip = new JSZip();
   const structured = selectedFileStructuredJson as { pages?: Array<{ pageNumber?: number; markdown?: string; text?: string }> } | undefined;
   const structuredPages = structured?.pages;
   const pages: Array<{ pageNumber: number; markdown: string }> = [];
   if (Array.isArray(structuredPages) && structuredPages.length > 0) {
     for (const page of structuredPages) {
       const md = typeof page.markdown === "string" ? page.markdown : typeof page.text === "string" ? page.text : "";
       if (md.trim().length === 0) continue;
       pages.push({ pageNumber: typeof page.pageNumber === "number" ? page.pageNumber : pages.length + 1, markdown: md });
     }
   }
   if (pages.length === 0) pages.push({ pageNumber: 1, markdown: selectedFileMarkdown });

   const indexLines = [`# ${stem}`, "", `Pages: ${pages.length}`, ""];
   if (pages.length > 1) {
     indexLines.push("## Pages");
     for (const page of pages) {
       const padded = String(page.pageNumber).padStart(3, "0");
       indexLines.push(`- [Page ${page.pageNumber}](pages/page-${padded}.md)`);
     }
     indexLines.push("");
   }
   indexLines.push("All pages joined: [all-pages.md](all-pages.md)", "");
   zip.file(`${stem}/index.md`, indexLines.join("\n"));
   for (const page of pages) {
     const padded = String(page.pageNumber).padStart(3, "0");
     zip.file(`${stem}/pages/page-${padded}.md`, page.markdown.trim() + "\n");
   }
   zip.file(`${stem}/all-pages.md`, pages.map((p) => `## Page ${p.pageNumber}\n\n${p.markdown.trim()}\n`).join("\n"));

   const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
   const url = URL.createObjectURL(blob);
   const a = document.createElement("a");
   a.href = url;
   a.download = `${stem}-pages.zip`;
   a.click();
   URL.revokeObjectURL(url);

   toast({
     title: t("Download avviato","Download started","Téléchargement démarré","Descarga iniciada","Download gestartet"),
     description: `${stem}-pages.zip`,
   });
   return;
 }

 const text = type ==="md"? selectedFileMarkdown
 : JSON.stringify(selectedFileStructuredJson, null, 2);
 const blob = new Blob([text], { type: type ==="md"?"text/markdown":"application/json"});
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `${stem}.${type ==="md"?"md":"json"}`;
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
 if (!selectedFile) {
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
 const restoredPages = Array.isArray(selectedFile.pagePreviews)
 ? selectedFile.pagePreviews.filter(Boolean)
 : [];
 if (restoredPages.length > 1) {
 pdfPagePreviewCacheRef.current[selectedFile.id] = restoredPages;
 setAllPagePreviews(restoredPages);
 setAllPagePreviewsForFileId(selectedFile.id);
 return;
 }
 if (!selectedFile.file || !isPdfFile(selectedFile.file)) {
 const single = selectedFile.preview?.trim() || restoredPages[0];
 setAllPagePreviews(single ? [single] : []);
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
 const inMemoryPages = pdfPagePreviewCacheRef.current[file.id];
 if (Array.isArray(inMemoryPages) && inMemoryPages.length > 0) {
 return inMemoryPages;
 }

 if (file.file && isPdfFile(file.file)) {
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

 const ppRaw = value.postProcessing;
 const postProcessing = ppRaw && typeof ppRaw === "object" && !Array.isArray(ppRaw)
   ? (() => {
       const pp = ppRaw as Record<string, unknown>;
       return {
         enabled: Boolean(pp.enabled),
         model: typeof pp.model === "string" ? pp.model : undefined,
         outputFormat: typeof pp.outputFormat === "string" ? pp.outputFormat : undefined,
         elapsedMs: typeof pp.elapsedMs === "number" ? pp.elapsedMs : undefined,
         startedAt: typeof pp.startedAt === "string" ? pp.startedAt : undefined,
         error: typeof pp.error === "string" ? pp.error : undefined,
       };
     })()
   : undefined;

 const auditRaw = value.piiAudit;
 const piiAudit = auditRaw && typeof auditRaw === "object" && !Array.isArray(auditRaw)
   ? (() => {
       const a = auditRaw as Record<string, unknown>;
       const counts = a.countsByKind && typeof a.countsByKind === "object" && !Array.isArray(a.countsByKind)
         ? Object.fromEntries(
             Object.entries(a.countsByKind as Record<string, unknown>)
               .filter(([, v]) => typeof v === "number")
               .map(([k, v]) => [k, v as number]),
           )
         : {};
       const total = Object.values(counts).reduce((acc, n) => acc + n, 0);
       return { applied: Boolean(a.applied), countsByKind: counts, total };
     })()
   : undefined;

 return {
 stage: typeof value.stage ==="string"? value.stage : undefined,
 message: typeof value.message ==="string"? value.message : undefined,
 progressPct: typeof value.progressPct ==="number"? value.progressPct : undefined,
 pageCount: typeof value.pageCount ==="number"? value.pageCount : undefined,
 processedPages: typeof value.processedPages ==="number"? value.processedPages : undefined,
 etaSeconds: typeof value.etaSeconds ==="number"? value.etaSeconds : null,
 postProcessing,
 piiAudit,
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
 postProcessing: progressMeta?.postProcessing
   ? {
       enabled: progressMeta.postProcessing.enabled,
       model: progressMeta.postProcessing.model,
       outputFormat: progressMeta.postProcessing.outputFormat,
       elapsedMs: progressMeta.postProcessing.elapsedMs,
       startedAt: progressMeta.postProcessing.startedAt,
       error: progressMeta.postProcessing.error,
     }
   : entry.postProcessing,
 piiAudit: progressMeta?.piiAudit ?? entry.piiAudit,
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
 if (pageNumbers && file.file && isPdfFile(file.file) && file.file.size <= SOURCE_PDF_MAX_BYTES) {
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
 if (isProcessingRef.current) return;
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
 const isTranslate = postProcessing.template === "translate";
 toast({
 title: isTranslate
 ? t("Lingua di destinazione mancante", "Target language missing", "Langue cible manquante", "Falta idioma de destino", "Zielsprache fehlt")
 : t("Istruzione post-processing mancante","Missing post-processing instruction","Instruction de post-traitement manquante","Falta instrucción de post-procesamiento","Anweisung für Nachverarbeitung fehlt"),
 description: isTranslate
 ? t("Indica la lingua di destinazione (es. Italiano, Francese) prima di avviare l'OCR.", "Enter a target language (e.g. Italian, French) before running OCR.", "Indique la langue cible (ex. Italien, Français) avant de lancer l'OCR.", "Indica el idioma de destino (p. ej. Italiano, Francés) antes de iniciar OCR.", "Zielsprache angeben (z. B. Italienisch, Französisch), bevor OCR gestartet wird.")
 : t("Aggiungi un'istruzione o disattiva il post-processing prima di avviare l'OCR.","Add an instruction or disable post-processing before running OCR.","Ajoutez une instruction ou désactivez le post-traitement avant de lancer l'OCR.","Añade una instrucción o desactiva el post-procesamiento antes de iniciar OCR.","Anweisung hinzufügen oder Nachverarbeitung deaktivieren, bevor OCR gestartet wird."),
 variant:"destructive",
 });
 return;
 }

 if (!isClientOnline()) {
  setIsOnline(false);
  const targets = files.filter((f) => (f.status === "pending" || f.status === "offline-queued") && (!filterIds || filterIds.has(f.id)));
  if (targets.length === 0) return;
  setFiles((prev) => prev.map((f) => (targets.some((t) => t.id === f.id) ? { ...f, status: "offline-queued" as const, error: undefined } : f)));
  toast({
   title: t("Offline", "Offline", "Hors ligne", "Sin conexión", "Offline"),
   description: t(
    `${targets.length} file in coda. Verranno inviati al ritorno online.`,
    `${targets.length} file${targets.length === 1 ? "" : "s"} queued. They'll submit when you're back online.`,
    `${targets.length} fichier${targets.length === 1 ? "" : "s"} en file. Ils seront envoyés au retour en ligne.`,
    `${targets.length} archivo${targets.length === 1 ? "" : "s"} en cola. Se enviarán al volver en línea.`,
    `${targets.length} ${targets.length === 1 ? "Datei" : "Dateien"} in Warteschlange. Werden gesendet, sobald du wieder online bist.`,
   ),
  });
  return;
 }

 isProcessingRef.current = true;
 setIsProcessing(true);
 const filesToProcess = files.filter((f) => (f.status === "pending" || f.status === "offline-queued") && (!filterIds || filterIds.has(f.id)));
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
 if (!isClientOnline() || isNetworkError(error)) {
  updateFileById(file.id, (entry) => ({
   ...entry,
   status:"offline-queued",
   error: undefined,
  }));
  setIsOnline(false);
  continue;
 }
 updateFileById(file.id, (entry) => ({
 ...entry,
 status:"error",
 error: error instanceof Error ? error.message : t("Elaborazione non riuscita","Processing failed","Échec du traitement","Procesamiento fallido","Verarbeitung fehlgeschlagen"),
 }));
 }
 }

 isProcessingRef.current = false;
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

 const processFilesRef = React.useRef(processFiles);
 React.useEffect(() => {
  processFilesRef.current = processFiles;
 });

 React.useEffect(() => {
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
   setIsOnline(navigator.onLine);
  }
  const unsubscribe = subscribeNetworkStatus((online) => {
   setIsOnline(online);
   if (!online) return;
   const queued = filesRef.current.filter((f) => f.status === "offline-queued");
   if (queued.length === 0) return;
   const ids = new Set(queued.map((f) => f.id));
   void processFilesRef.current(ids);
  });
  return unsubscribe;
 }, []);

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
 if (isProcessingRef.current) return;
 isProcessingRef.current = true;
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
 isProcessingRef.current = false;
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

 setFiles([]);
 setSelectedFileId(null);
 setBulkSelectedIds(new Set());
 pdfPagePreviewCacheRef.current = {};
 await clearQueue();
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
        onOpenAccount={() => setAccountDialogOpen(true)}
        onChangePassword={() => setChangePasswordOpen(true)}
        onSignOut={signOut}
        isSigningOut={isSigningOut}
        isOnline={isOnline}
        offlineQueuedCount={files.filter((f) => f.status === "offline-queued").length}
      />

      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
        t={t}
      />

      <AccountDialog
        open={accountDialogOpen}
        onOpenChange={setAccountDialogOpen}
        t={t}
        uiLanguage={uiLanguage}
        setUiLanguage={setUiLanguage}
        onRestartTour={() => { setAccountDialogOpen(false); void restartTour(); }}
      />

      <OnboardingTour t={t} />

      <SetupWizard
        open={setupWizardOpen}
        onOpenChange={setSetupWizardOpen}
        t={t}
        initial={apiSettings}
        defaultEndpointForProvider={defaultEndpointForProvider}
        onSave={saveApiSettingsDirect}
        onFinished={() => { void restartTour(); }}
        onSkip={() => undefined}
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
 <TabsTrigger value="ocr"className="gap-1.5 px-2.5"><SparklesIcon size={14} className="inline-flex items-center justify-center"/>OCR</TabsTrigger>
 <TabsTrigger value="kb"className="gap-1.5 px-2.5"><DatabaseBackupIcon size={14} className="inline-flex items-center justify-center"/>{t("Knowledge base","Knowledge base","Base de connaissances","Base de conocimiento","Wissensdatenbank")}</TabsTrigger>
 <TabsTrigger value="storage"className="gap-1.5 px-2.5"><Cloud className="size-3.5"/>{t("Archiviazione","Storage","Stockage","Almacenamiento","Speicher")}</TabsTrigger>
 <TabsTrigger value="integrations"className="gap-1.5 px-2.5"><Plug className="size-3.5"/>{t("Integrazioni","Integrations","Intégrations","Integraciones","Integrationen")}</TabsTrigger>
 <TabsTrigger value="templates"className="gap-1.5 px-2.5"><Layers className="size-3.5"/>{t("Template","Templates","Modèles","Plantillas","Vorlagen")}</TabsTrigger>
 </TabsList>
 </div>

 <ScrollArea className="flex-1 min-h-0 px-6 pb-2">
 <TabsContent value="ocr"className="mt-4 space-y-3">
 <SettingsAccordion value={ocrAccordionOpen} onValueChange={setOcrAccordionOpen} storageKey="extracto.settings.ocr.open">
 <SettingsAccordionItem
 value="provider"
 title={t("Provider","Provider","Fournisseur","Proveedor","Anbieter")}
 hint={t(
"Dove gira l'intelligenza artificiale che legge i tuoi documenti.",
"Where the AI that reads your documents actually runs.",
"Où l'IA qui lit vos documents s'exécute.",
"Dónde se ejecuta la IA que lee tus documentos.",
"Wo die KI läuft, die deine Dokumente liest.",
)}
 >
 <div className="space-y-3">
 <div className="space-y-1.5">
 <HintLabel hint={t("Dove gira il modello che legge i tuoi documenti. Ollama è locale e gratis; Mistral OCR e OpenRouter sono API a pagamento; OpenAI-compatible punta a qualsiasi endpoint compatibile.","Where the model that reads your documents runs. Ollama is local and free; Mistral OCR and OpenRouter are paid APIs; OpenAI-compatible points at any compatible endpoint.","Où s'exécute le modèle qui lit vos documents. Ollama est local et gratuit ; Mistral OCR et OpenRouter sont des API payantes ; OpenAI-compatible cible tout endpoint compatible.","Dónde se ejecuta el modelo que lee tus documentos. Ollama es local y gratis; Mistral OCR y OpenRouter son APIs de pago; OpenAI-compatible apunta a cualquier endpoint compatible.","Wo das Modell läuft, das deine Dokumente liest. Ollama ist lokal und kostenlos; Mistral OCR und OpenRouter sind kostenpflichtige APIs; OpenAI-compatible zeigt auf jeden kompatiblen Endpunkt.")}>{t("Provider","Provider","Fournisseur","Proveedor","Anbieter")}</HintLabel>
 <Select value={apiSettingsDraft.provider} onValueChange={(value) => setApiSettingsDraft((prev) => {
   const nextProvider = normalizeProvider(value);
   if (nextProvider === prev.provider) return prev;
   setApiKeyDirty(true);
   return { ...prev, provider: nextProvider, apiEndpoint: defaultEndpointForProvider(nextProvider), apiKey: "", hasApiKey: false };
 })}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="ollama">Ollama</SelectItem>
 <SelectItem value="mistral">Mistral OCR API</SelectItem>
 <SelectItem value="openrouter">OpenRouter</SelectItem>
 <SelectItem value="openai_compat">OpenAI-compatible</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <HintLabel hint={t("URL HTTP del provider. Cambia il provider sopra per popolare il default; sovrascrivi solo se hai un endpoint personalizzato (es. self-hosted Ollama o gateway corporate).","HTTP URL of the provider. Switching the provider above fills the default; override only if you run a custom endpoint (e.g. self-hosted Ollama or a corporate gateway).","URL HTTP du fournisseur. Changer le fournisseur ci-dessus remplit la valeur par défaut ; ne remplace que si tu as un endpoint personnalisé.","URL HTTP del proveedor. Cambiar el proveedor arriba rellena el valor por defecto; sobrescribe solo si tienes un endpoint personalizado.","HTTP-URL des Anbieters. Beim Wechsel des Anbieters wird der Standard gesetzt; überschreibe nur, wenn du einen eigenen Endpunkt hast.")}>Endpoint</HintLabel>
 <Input value={apiSettingsDraft.apiEndpoint} onChange={(event) => setApiSettingsDraft((prev) => ({ ...prev, apiEndpoint: event.target.value }))} placeholder={defaultEndpointForProvider(normalizeProvider(apiSettingsDraft.provider))}/>
 </div>
 <div className="space-y-1.5">
 <HintLabel hint={t("Chiave API del provider. Salvata cifrata sul disco accanto al DB; non viene mai inviata al browser. Lascia vuoto per Ollama locale.","Provider API key. Stored encrypted on disk next to the DB; never sent back to the browser. Leave blank for local Ollama.","Clé API du fournisseur. Stockée chiffrée à côté du DB ; jamais renvoyée au navigateur. Laisser vide pour Ollama local.","Clave API del proveedor. Se guarda cifrada en disco junto al DB; nunca se envía al navegador. Déjala vacía para Ollama local.","API-Schlüssel des Anbieters. Wird verschlüsselt neben der DB gespeichert; nie an den Browser zurückgesendet. Für lokales Ollama leer lassen.")}>API key</HintLabel>
 <Input
 type="password"
 value={apiSettingsDraft.apiKey}
 onChange={(event) => setApiSettingsDraft((prev) => { setApiKeyDirty(true); return { ...prev, apiKey: event.target.value }; })}
 placeholder={!apiKeyDirty && apiSettingsDraft.hasApiKey ? t("Salvata (nascosta)","Saved (hidden)","Enregistrée (masquée)","Guardada (oculta)","Gespeichert (verborgen)") :"sk-..."}
 />
 {!apiKeyDirty && apiSettingsDraft.hasApiKey ? (
 <p className="text-[11px] text-muted-foreground/80">{t("Lascia invariata per mantenere la chiave corrente.","Leave unchanged to keep the current key.","Laissez tel quel pour conserver la clé.","Déjala igual para mantener la clave.","Unverändert lassen, um den aktuellen Schlüssel zu behalten.")}</p>
 ) : null}
 </div>
 </div>
 </SettingsAccordionItem>

 <SettingsAccordionItem
 value="model"
 title={t("Modello e velocità","Model and speed","Modèle et vitesse","Modelo y velocidad","Modell und Geschwindigkeit")}
 hint={t(
"Quale modello legge ogni pagina e quante pagine processare in parallelo.",
"Which model reads each page and how many pages run in parallel.",
"Quel modèle lit chaque page et combien de pages traiter en parallèle.",
"Qué modelo lee cada página y cuántas se procesan en paralelo.",
"Welches Modell jede Seite liest und wie viele Seiten parallel laufen.",
)}
 >
 <div className="space-y-4">
 <div className="space-y-1.5">
 <HintLabel hint={t("Il modello che legge ogni pagina del documento. Modelli vision (es. mistral-ocr, qwen2-vl, llama3.2-vision) gestiscono tabelle e layout meglio dei modelli solo testo.","The model that reads each page of the document. Vision models (e.g. mistral-ocr, qwen2-vl, llama3.2-vision) handle tables and layout better than text-only models.","Le modèle qui lit chaque page. Les modèles vision (mistral-ocr, qwen2-vl, llama3.2-vision) gèrent mieux tableaux et mises en page que les modèles texte.","El modelo que lee cada página. Los modelos vision (mistral-ocr, qwen2-vl, llama3.2-vision) manejan tablas y layout mejor que los de solo texto.","Das Modell, das jede Seite liest. Vision-Modelle (mistral-ocr, qwen2-vl, llama3.2-vision) handhaben Tabellen und Layout besser als reine Textmodelle.")}>{t("Modello OCR","OCR model","Modèle OCR","Modelo OCR","OCR-Modell")}</HintLabel>
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
 <button type="button" onClick={() => setRecommendationsOpen(true)} className="text-[11px] text-primary hover:underline self-start inline-flex items-center gap-1">
   <TrendingUp className="size-3" />
   {t("Vedi modelli consigliati per i tuoi documenti","See recommended models for your documents","Voir les modèles recommandés","Ver modelos recomendados","Empfohlene Modelle ansehen")}
 </button>
 </div>
 <div className="space-y-1.5">
 <HintLabel hint={t("Quante pagine processare contemporaneamente. 0 lascia decidere a Extracto (di solito 1-2). Più alto = più veloce ma più carico sul provider e sulla GPU/CPU. Per Mistral OCR 4-8 va bene; per Ollama locale di solito 1-2.","How many pages to process at the same time. 0 lets Extracto pick (usually 1-2). Higher means faster but more load on the provider and GPU/CPU. Mistral OCR can handle 4-8; local Ollama usually 1-2.","Combien de pages traiter simultanément. 0 laisse Extracto choisir (1-2 d'habitude). Plus élevé = plus rapide mais plus de charge.","Cuántas páginas se procesan a la vez. 0 deja decidir a Extracto (1-2 normalmente). Más alto = más rápido pero más carga.","Wie viele Seiten gleichzeitig verarbeitet werden. 0 lässt Extracto entscheiden (meist 1-2). Höher heißt schneller, aber mehr Last.")}>{t("Pagine in parallelo","Pages in parallel","Pages en parallèle","Páginas en paralelo","Seiten parallel")}</HintLabel>
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
 <p className="text-[11px] text-muted-foreground/70">{t(
"0 = automatico (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Massimo 16.",
"0 = auto (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Max 16.",
"0 = auto (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Max 16.",
"0 = automático (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Máximo 16.",
"0 = automatisch (Ollama 1, Mistral 4, OpenRouter 4, OpenAI-compat 2). Max. 16.",
)}</p>
 </div>
 </div>
 </SettingsAccordionItem>

 <SettingsAccordionItem
 value="post"
 title={t("Rifinitura output","Polish output","Affiner la sortie","Refinar resultado","Ergebnis verfeinern")}
 hint={t(
"Una seconda passata facoltativa per ripulire il risultato o estrarre campi specifici.",
"Optional second pass to clean up the result or pull specific fields.",
"Une seconde passe optionnelle pour nettoyer le résultat ou en extraire des champs.",
"Segunda pasada opcional para limpiar el resultado o extraer campos.",
"Optionaler zweiter Durchgang, um das Ergebnis zu bereinigen oder Felder zu extrahieren.",
)}
 right={
 <Switch checked={postProcessing.enabled} onCheckedChange={(enabled) => { setPostProcessing((prev) => ({ ...prev, enabled })); if (enabled) setOcrAccordionOpen("post"); }} />
 }
 >
 {postProcessing.enabled ? (
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Template","Template","Modèle","Plantilla","Vorlage")}</Label>
 <Select value={postProcessing.template} onValueChange={(v) => setPostProcessing((prev) => ({ ...prev, template: v as typeof prev.template }))}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="custom">{t("Personalizzato","Custom","Personnalisé","Personalizado","Eigene")}</SelectItem>
 <SelectItem value="translate">{t("Traduci","Translate","Traduire","Traducir","Übersetzen")}</SelectItem>
 <SelectItem value="summarize-3sentence">{t("Riassunto in 3 frasi","Three-sentence summary","Résumé en 3 phrases","Resumen en 3 frases","Drei-Satz-Zusammenfassung")}</SelectItem>
 <SelectItem value="summarize-executive">{t("Riassunto esecutivo","Executive summary","Résumé exécutif","Resumen ejecutivo","Executive Summary")}</SelectItem>
 <SelectItem value="extract-actions">{t("Estrai azioni","Extract action items","Extraire les actions","Extraer acciones","Aktionen extrahieren")}</SelectItem>
 </SelectContent>
 </Select>
 </div>
 {postProcessing.template === "translate" ? (
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Lingua di destinazione","Target language","Langue cible","Idioma destino","Zielsprache")}</Label>
 <Input value={postProcessing.targetLanguage} onChange={(e) => setPostProcessing((prev) => ({ ...prev, targetLanguage: e.target.value }))} placeholder="Italian, French, Japanese..." />
 </div>
 ) : null}
 </div>
 {postProcessing.template === "custom" ? (
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
 ) : null}
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
 ) : (
 <p className="text-[12px] text-muted-foreground/80">{t(
"Attiva la rifinitura per riformattare l'output o estrarre campi specifici.",
"Turn on to reformat the output or pull specific fields.",
"Activez pour reformater la sortie ou extraire des champs.",
"Activa para reformatear el resultado o extraer campos.",
"Aktivieren, um die Ausgabe umzuformatieren oder Felder zu extrahieren.",
)}</p>
 )}
 </SettingsAccordionItem>
 </SettingsAccordion>

 <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-card/85 backdrop-blur-sm hairline-t flex justify-end z-10">
 <Button onClick={saveApiSettings} disabled={isSavingApiSettings}>
 {isSavingApiSettings ? <LoaderCircleIcon size={16} className="inline-flex items-center justify-center mr-1.5 animate-spin"/> : null}
 {t("Salva provider","Save provider","Enregistrer le fournisseur","Guardar proveedor","Provider speichern")}
 </Button>
 </div>
 </TabsContent>

 <TabsContent value="kb"className="mt-4 space-y-3">
 <SettingsAccordion defaultOpen="embedding" storageKey="extracto.settings.kb.open">
 <SettingsAccordionItem
 value="embedding"
 title={t("Embedding","Embeddings","Embeddings","Embeddings","Embeddings")}
 hint={t(
"Come il testo diventa vettori cercabili.",
"How text becomes searchable vectors.",
"Comment le texte devient des vecteurs interrogeables.",
"Cómo el texto se convierte en vectores buscables.",
"Wie Text in durchsuchbare Vektoren umgewandelt wird.",
)}
 >
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <HintLabel hint={t("Chi calcola gli embedding (i numeri che rappresentano il significato del testo). Ollama è locale e gratis; OpenRouter e i provider OpenAI-compatible sono a pagamento ma più precisi.","Who computes the embeddings (the numbers that represent the text's meaning). Ollama is local and free; OpenRouter and OpenAI-compatible providers are paid but usually higher quality.","Qui calcule les embeddings (les nombres qui représentent le sens du texte). Ollama est local et gratuit ; OpenRouter et les fournisseurs OpenAI-compatibles sont payants mais souvent meilleurs.","Quién calcula los embeddings (los números que representan el significado del texto). Ollama es local y gratis; OpenRouter y los proveedores OpenAI-compatibles son de pago pero suelen ser mejores.","Wer die Embeddings berechnet (die Zahlen, die die Bedeutung des Textes darstellen). Ollama ist lokal und kostenlos; OpenRouter und OpenAI-kompatible Anbieter kosten Geld, sind aber oft präziser.")}>{t("Provider","Provider","Fournisseur","Proveedor","Anbieter")}</HintLabel>
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
 <HintLabel hint={t("URL HTTP del provider di embedding. Se cambi provider sopra, il default viene popolato automaticamente.","HTTP URL of the embedding provider. The default fills in automatically when you switch the provider above.","URL HTTP du fournisseur d'embedding. Le défaut se remplit automatiquement quand vous changez de fournisseur.","URL HTTP del proveedor de embeddings. El valor por defecto se rellena automáticamente al cambiar el proveedor.","HTTP-URL des Embedding-Anbieters. Beim Wechsel des Anbieters wird der Standard automatisch gesetzt.")}>Endpoint</HintLabel>
 <Input value={kbDefaultsDraft.embeddingEndpoint} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, embeddingEndpoint: e.target.value }))} placeholder="http://127.0.0.1:11434"/>
 </div>
 <div className="space-y-1.5">
 <HintLabel hint={t("Il modello di embedding. nomic-embed-text e mxbai-embed-large sono buone scelte locali. Le dimensioni a destra devono corrispondere a quelle del modello scelto.","The embedding model. nomic-embed-text and mxbai-embed-large are solid local picks. The Dimensions field on the right must match the model's vector size.","Le modèle d'embedding. nomic-embed-text et mxbai-embed-large sont de bons choix locaux. Le champ Dimensions à droite doit correspondre à la taille du vecteur du modèle.","El modelo de embeddings. nomic-embed-text y mxbai-embed-large son opciones locales sólidas. El campo Dimensions a la derecha debe coincidir con el tamaño del vector del modelo.","Das Embedding-Modell. nomic-embed-text und mxbai-embed-large sind solide lokale Optionen. Das Dimensions-Feld rechts muss zur Vektorgröße des Modells passen.")}>{t("Modello","Model","Modèle","Modelo","Modell")}</HintLabel>
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
 <HintLabel hint={t("Chiave API del provider di embedding. Lascia vuoto per Ollama locale.","API key for the embedding provider. Leave blank for local Ollama.","Clé API du fournisseur d'embedding. Laisser vide pour Ollama local.","Clave API del proveedor de embeddings. Déjala vacía para Ollama local.","API-Schlüssel des Embedding-Anbieters. Für lokales Ollama leer lassen.")}>API key</HintLabel>
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
 </SettingsAccordionItem>

 <SettingsAccordionItem
 value="chunking"
 title={t("Suddivisione testo","Text chunking","Découpage du texte","Fragmentación del texto","Textaufteilung")}
 hint={t(
"Come il testo viene tagliato in pezzi prima di essere indicizzato.",
"How text is sliced into pieces before indexing.",
"Comment le texte est découpé en morceaux avant indexation.",
"Cómo se trocea el texto antes de indexar.",
"Wie Text vor der Indexierung in Stücke geteilt wird.",
)}
 >
 <div className="space-y-3">
 <div className="space-y-1.5">
 <HintLabel hint={t("Come spezzare il testo prima di indicizzarlo. 'Per paragrafo' è il default robusto. 'Gerarchico' segue i titoli markdown. 'Semantico' taglia dove gli embedding di frasi consecutive sono più diversi (più costoso ma più pulito).","How to slice the text before indexing. 'Per paragraph' is the safe default. 'Hierarchical' follows markdown headings. 'Semantic' cuts where consecutive sentence embeddings differ most (slower but cleaner).","Comment découper le texte avant indexation. « Par paragraphe » est le défaut sûr. « Hiérarchique » suit les titres markdown. « Sémantique » coupe là où les embeddings de phrases consécutives diffèrent le plus.","Cómo trocear el texto antes de indexar. 'Por párrafo' es la opción segura por defecto. 'Jerárquico' sigue los títulos markdown. 'Semántico' corta donde los embeddings de frases consecutivas más difieren.","Wie der Text vor der Indexierung geteilt wird. 'Pro Absatz' ist der robuste Standard. 'Hierarchisch' folgt Markdown-Überschriften. 'Semantisch' schneidet dort, wo die Embeddings aufeinanderfolgender Sätze am stärksten abweichen.")}>{t("Strategia","Strategy","Stratégie","Estrategia","Strategie")}</HintLabel>
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
 <HintLabel hint={t("Lunghezza massima di un chunk in caratteri. 800-1600 funziona bene per la maggior parte dei modelli di embedding.","Maximum chunk length in characters. 800-1600 works well for most embedding models.","Longueur maximale d'un chunk en caractères. 800-1600 convient à la plupart des modèles d'embedding.","Longitud máxima del fragmento en caracteres. 800-1600 funciona bien para la mayoría de modelos de embeddings.","Maximale Chunk-Länge in Zeichen. 800-1600 passt zu den meisten Embedding-Modellen.")}>{t("Max","Max","Max","Máx","Max")}</HintLabel>
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
 </SettingsAccordionItem>

 <SettingsAccordionItem
 value="store"
 title={t("Database vettoriale","Vector database","Base vectorielle","Base vectorial","Vektordatenbank")}
 hint={t(
"Dove vengono salvati i vettori dei tuoi documenti.",
"Where your document vectors are stored.",
"Où sont stockés les vecteurs de vos documents.",
"Dónde se guardan los vectores de tus documentos.",
"Wo deine Dokument-Vektoren gespeichert werden.",
)}
 >
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <HintLabel hint={t("Quale database vettoriale ricevere. Chroma e Qdrant si auto-installano facilmente; Pinecone e Typesense richiedono account/API key. Tutti supportano upsert + cosine search.","Which vector database to write to. Chroma and Qdrant are easy to self-host; Pinecone and Typesense need an account/API key. All support upsert + cosine search.","Quelle base vectorielle utiliser. Chroma et Qdrant sont faciles à auto-héberger ; Pinecone et Typesense requièrent un compte/API key. Toutes supportent upsert + recherche cosine.","Qué base vectorial usar. Chroma y Qdrant son fáciles de auto-alojar; Pinecone y Typesense necesitan cuenta/API key. Todas soportan upsert + búsqueda coseno.","Welche Vektordatenbank. Chroma und Qdrant sind leicht selbst zu hosten; Pinecone und Typesense brauchen ein Konto/API-Key. Alle unterstützen Upsert und Cosine-Suche.")}>{t("Tipo","Kind","Type","Tipo","Typ")}</HintLabel>
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
 <HintLabel hint={t("Dimensione del vettore atteso dal vector store. Deve essere uguale a quella del modello di embedding sopra (es. nomic-embed-text → 768).","Vector size the store expects. Must match the embedding model's dimensions above (e.g. nomic-embed-text → 768).","Taille de vecteur attendue par le store. Doit correspondre aux dimensions du modèle d'embedding ci-dessus.","Tamaño de vector que el store espera. Debe coincidir con las dimensiones del modelo de embeddings de arriba.","Vom Store erwartete Vektorgröße. Muss zu den Dimensionen des Embedding-Modells oben passen.")}>{t("Dimensioni","Dimensions","Dimensions","Dimensiones","Dimensionen")}</HintLabel>
 <Input type="number"min={1} max={32768} value={kbDefaultsDraft.storeDimensions} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, storeDimensions: e.target.value }))} placeholder="768"/>
 </div>
 </div>
 <div className="space-y-1.5">
 <HintLabel hint={t("URL HTTP del vector store. Cambia il tipo sopra per popolare il default; sovrascrivi per puntare a un'istanza self-hosted o cloud.","HTTP URL of the vector store. Switching the kind above fills in the default; override to point at a self-hosted or cloud instance.","URL HTTP du vector store. Changer le type ci-dessus remplit le défaut ; modifier pour cibler une instance auto-hébergée ou cloud.","URL HTTP del vector store. Cambiar el tipo arriba rellena el valor por defecto; sobrescríbelo para apuntar a una instancia auto-alojada o en la nube.","HTTP-URL des Vektor-Stores. Beim Wechsel des Typs wird der Standard gesetzt; überschreibe ihn für eine selbst gehostete oder Cloud-Instanz.")}>Base URL</HintLabel>
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
 <HintLabel hint={t("Chiave API del vector store, se richiesta. Pinecone e Typesense la richiedono; Chroma/Qdrant/Weaviate self-hosted di solito no.","Vector store API key, when required. Pinecone and Typesense need one; self-hosted Chroma/Qdrant/Weaviate usually do not.","Clé API du vector store, si nécessaire. Requise pour Pinecone et Typesense ; Chroma/Qdrant/Weaviate auto-hébergés n'en ont généralement pas besoin.","Clave API del vector store, si la pide. Pinecone y Typesense la requieren; Chroma/Qdrant/Weaviate auto-alojados normalmente no.","API-Schlüssel des Vektor-Stores, falls nötig. Pinecone und Typesense brauchen einen; selbst gehostete Chroma/Qdrant/Weaviate meist nicht.")}>API key</HintLabel>
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
 </SettingsAccordionItem>
 </SettingsAccordion>

 <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-card/85 backdrop-blur-sm hairline-t flex justify-end z-10">
 <Button onClick={saveKbDefaults} disabled={isSavingKbDefaults}>
 {isSavingKbDefaults ? <LoaderCircleIcon size={16} className="inline-flex items-center justify-center mr-1.5 animate-spin"/> : null}
 {t("Salva knowledge base","Save knowledge base","Enregistrer KB","Guardar KB","KB speichern")}
 </Button>
 </div>
 </TabsContent>

 <TabsContent value="storage"className="mt-4">
 <SettingsAccordion defaultOpen="s3" storageKey="extracto.settings.storage.open">
 <SettingsAccordionItem
 value="s3"
 title={t("Archiviazione S3","S3 cloud storage","Stockage S3","Almacenamiento S3","S3-Cloud-Speicher")}
 hint={t(
"Connetti un bucket per ingressi ed esportazioni.",
"Connect a bucket for inputs and exports.",
"Connectez un bucket pour les entrées et exports.",
"Conecta un bucket para entradas y exportaciones.",
"Verbinde einen Bucket für Eingaben und Exporte.",
)}
 >
 <S3SettingsSection t={t} />
 </SettingsAccordionItem>

 <SettingsAccordionItem
 value="watchers"
 title={t("Cartelle monitorate","Watched folders","Dossiers surveillés","Carpetas vigiladas","Beobachtete Ordner")}
 hint={t(
"Importa automaticamente i documenti che arrivano in cartelle specifiche.",
"Auto-import documents that land in specific folders.",
"Importez automatiquement les documents arrivant dans des dossiers spécifiques.",
"Importa automáticamente los documentos que llegan a carpetas específicas.",
"Importiere automatisch Dokumente, die in bestimmten Ordnern landen.",
)}
 >
 <WatchersSection t={t} />
 </SettingsAccordionItem>
 </SettingsAccordion>
 </TabsContent>

 <TabsContent value="integrations"className="mt-4">
 <IntegrationsPanel t={t} />
 </TabsContent>

 <TabsContent value="templates"className="space-y-5 mt-4">
 <TemplatesSection t={t} />
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

      <CloudImportDialog
        open={cloudImportOpen}
        onOpenChange={setCloudImportOpen}
        defaultModel={selectedModel || ""}
        connected={cloudConnected}
        t={t}
      />

      <CloudExportDialog
        open={cloudExportDialog.open}
        onOpenChange={(open) => setCloudExportDialog((prev) => ({ ...prev, open }))}
        provider={cloudExportDialog.provider}
        fileName={cloudExportDialog.file?.file?.name}
        t={t}
        onSubmit={submitCloudExport}
      />

      <CompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        selectedFile={selectedFile ?? null}
        models={models}
        defaultModel={selectedModel || ""}
        configuredProvider={apiSettings.provider}
        t={t}
      />

      <RecommendationsDialog
        open={recommendationsOpen}
        onOpenChange={setRecommendationsOpen}
        t={t}
      />

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
        onBulkTag={async (jobIds, tagIds) => {
          await tagState.bulkTag(jobIds, tagIds, "add");
          await history.loadJobs();
          if (history.selectedId) await history.loadDetail(history.selectedId);
        }}
        onPageSaved={async (jobId) => {
          await history.loadDetail(jobId);
          await history.loadJobs();
        }}
        onApplyFilters={historyApplyFilters}
        savedSearches={savedSearches.items}
        onSaveSearch={async (name, filters) => {
          await savedSearches.save(name, filters);
        }}
        onDeleteSavedSearch={savedSearches.remove}
        availableTags={tagState.tags}
        onCreateTag={tagState.createTag}
        onUpdateTag={async (id, patch) => {
          await tagState.updateTag(id, patch);
          await history.loadJobs();
          if (history.selectedId) await history.loadDetail(history.selectedId);
        }}
        onDeleteTag={async (id) => {
          await tagState.deleteTag(id);
          await history.loadJobs();
          if (history.selectedId) await history.loadDetail(history.selectedId);
        }}
        onUpdateJobTags={async (jobId, tagIds) => {
          await tagState.setJobTags(jobId, tagIds);
          await history.loadJobs();
          if (history.selectedId === jobId) await history.loadDetail(jobId);
        }}
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
              onCloudImport={() => setCloudImportOpen(true)}
              cloudConnected={cloudConnected.dropbox || cloudConnected.google_drive || cloudConnected.onedrive}
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
                  <CostEstimate
                    pendingFiles={files}
                    model={selectedModel}
                    postProcessingEnabled={postProcessing.enabled}
                    postProcessingModel={postProcessing.model}
                    postProcessingFormat={postProcessing.outputFormat}
                    t={t}
                  />
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
                            `Avvia (${pendingCount})`,
                            `Run (${pendingCount})`,
                            `Lancer (${pendingCount})`,
                            `Iniciar (${pendingCount})`,
                            `Starten (${pendingCount})`,
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

 <Collapsible open={advancedOptionsOpen} onOpenChange={setAdvancedOptionsOpen}>
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
 <div className="flex items-center gap-1.5">
 <Label className="text-sm font-medium">{t("Mascheramento PII","PII redaction","Caviardage PII","Redacción de PII","PII-Schwärzung")}</Label>
 <FieldHint>{t("Maschera automaticamente email, telefoni, carte, IBAN, IP, URL, date di nascita e SSN nel testo estratto. L'audit (tipi e offset, mai i valori) viene salvato sui metadati del job.","Auto-mask emails, phones, cards, IBANs, IPs, URLs, dates of birth, and SSNs in the extracted text. The audit trail (kinds and offsets, never the values) lives on the job metadata.","Masquer automatiquement les e-mails, téléphones, cartes, IBAN, IP, URL, dates de naissance et SSN dans le texte extrait. L'audit (types et offsets, jamais les valeurs) vit sur les métadonnées du job.","Enmascara automáticamente correos, teléfonos, tarjetas, IBAN, IP, URL, fechas de nacimiento y SSN en el texto extraído. La auditoría (tipos y desplazamientos, nunca los valores) vive en los metadatos del trabajo.","Maskiert automatisch E-Mails, Telefonnummern, Karten, IBANs, IPs, URLs, Geburtsdaten und SSNs im extrahierten Text. Der Audit-Trail (Typen und Offsets, nie die Werte) liegt auf den Job-Metadaten.")}</FieldHint>
 </div>
 <Switch checked={settings.piiRedaction} onCheckedChange={(piiRedaction) => setSettings((s) => ({ ...s, piiRedaction }))} />
 </div>
 </div>

 <div className="space-y-2 surface-soft rounded-xl px-3.5 py-3">
 <div className="flex items-center justify-between gap-2">
 <Label className="text-sm font-medium">{t("Post-processing","Post-processing","Post-traitement","Post-procesamiento","Nachverarbeitung")}</Label>
 <Switch checked={postProcessing.enabled} onCheckedChange={(enabled) => setPostProcessing((prev) => ({ ...prev, enabled }))} />
 </div>
 {postProcessing.enabled ? (
 <div className="space-y-2">
 <Select value={postProcessing.template} onValueChange={(v) => setPostProcessing((prev) => ({ ...prev, template: v as typeof prev.template }))}>
 <SelectTrigger className="h-8 text-xs w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="custom">{t("Personalizzato","Custom","Personnalisé","Personalizado","Eigene")}</SelectItem>
 <SelectItem value="translate">{t("Traduci","Translate","Traduire","Traducir","Übersetzen")}</SelectItem>
 <SelectItem value="summarize-3sentence">{t("Riassunto 3 frasi","3-sentence summary","Résumé 3 phrases","Resumen 3 frases","3-Satz-Zusammenfassung")}</SelectItem>
 <SelectItem value="summarize-executive">{t("Riassunto esecutivo","Executive summary","Résumé exécutif","Resumen ejecutivo","Executive Summary")}</SelectItem>
 <SelectItem value="extract-actions">{t("Estrai azioni","Extract actions","Extraire actions","Extraer acciones","Aktionen extrahieren")}</SelectItem>
 </SelectContent>
 </Select>
 {postProcessing.template === "translate" ? (
 <Input value={postProcessing.targetLanguage} onChange={(e) => setPostProcessing((prev) => ({ ...prev, targetLanguage: e.target.value }))} placeholder="Italian, French, Japanese..." className="h-8 text-xs bg-card"/>
 ) : null}
 {postProcessing.template === "custom" ? (
 <Textarea
 placeholder={t("Es: estrai numero fattura, scadenza, totali. Restituisci una tabella.","Ex: extract invoice number, due date, totals. Return one table.","Ex : extraire numéro, échéance, totaux. Renvoyer un tableau.","Ej: número, vencimiento, totales. Devuelve una tabla.","Bsp.: Rechnungsnummer, Fälligkeit, Summen. Eine Tabelle zurückgeben.")}
 value={postProcessing.instruction}
 onChange={(e) => setPostProcessing((prev) => ({ ...prev, instruction: e.target.value }))}
 className="min-h-[60px] text-xs bg-card"/>
 ) : null}
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
 data-tour="history-btn"
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
                    onSendToCloud={exportFileToCloud}
                    cloudConnected={cloudConnected}
                    onCompareModels={() => setCompareOpen(true)}
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
 <div className="px-3 pt-2 flex items-center gap-2">
 <TabsList className="h-8 flex-1 justify-start overflow-x-auto">
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
 {selectedFile.piiAudit?.applied ? (
 <Tooltip>
 <TooltipTrigger asChild>
 <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-6 shrink-0 cursor-default">
 <ShieldCheck className="size-3 mr-1"/>
 {t(`PII redatti (${selectedFile.piiAudit.total})`,`PII redacted (${selectedFile.piiAudit.total})`,`PII rédigés (${selectedFile.piiAudit.total})`,`PII redactados (${selectedFile.piiAudit.total})`,`PII redigiert (${selectedFile.piiAudit.total})`)}
 </Badge>
 </TooltipTrigger>
 <TooltipContent>
 {Object.entries(selectedFile.piiAudit.countsByKind)
   .filter(([, n]) => n > 0)
   .map(([k, n]) => `${k}: ${n}`)
   .join(", ") || t("Nessuna PII rilevata","No PII detected","Aucune PII détectée","Sin PII detectada","Keine PII erkannt")}
 </TooltipContent>
 </Tooltip>
 ) : null}
 </div>

 <TabsContent value="markdown"className="flex-1 m-0 min-h-0 min-w-0">
 <ScrollArea className="h-full w-full">
 <MarkdownView source={selectedFileMarkdown} className="p-4"/>
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
 {selectedFile.jobId ? (
 <div className="px-3 pb-3">
 <JobExtrasPanel jobId={selectedFile.jobId} documentPreset={settings.documentPreset} t={t} />
 </div>
 ) : null}
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
 {selectedFile.stage === "post_processing" && selectedFile.postProcessing?.enabled && !selectedFile.postProcessing.error ? (
 <div className="surface-soft rounded-xl px-3 py-2.5 flex items-center gap-3" data-testid="post-processing-card">
 <LoaderCircleIcon size={16} className="inline-flex items-center justify-center text-primary animate-spin"/>
 <div className="flex-1 min-w-0">
 <p className="text-xs font-medium">
 {t("Post-processing in corso","Post-processing in progress","Post-traitement en cours","Post-procesamiento en curso","Nachverarbeitung läuft")}
 </p>
 <p className="text-[11px] text-muted-foreground truncate">
 {selectedFile.postProcessing?.model || t("modello in elaborazione","model running","modèle en cours","modelo en curso","Modell läuft")}
 {selectedFile.postProcessing?.outputFormat ? ` · ${selectedFile.postProcessing.outputFormat}` : ""}
 </p>
 </div>
 {typeof selectedFile.postProcessing?.elapsedMs === "number" ? (
 <Badge variant="outline" className="tabular text-[10px]">
 {Math.floor(selectedFile.postProcessing.elapsedMs / 1000)}s
 </Badge>
 ) : null}
 </div>
 ) : null}
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
'Clicca "Avvia" per estrarre il testo',
'Click "Run" to extract text',
'Cliquez sur « Lancer » pour extraire le texte',
'Pulsa "Iniciar" para extraer el texto',
'Klicke auf „Starten", um den Text zu extrahieren',
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
