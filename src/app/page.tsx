"use client";

import * as React from"react";
import { motion, AnimatePresence } from"framer-motion";
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
 Database,
 DatabaseBackup,
 Info,
 MoreHorizontal,
 Github,
} from"lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from"@/components/ui/card";
import { ScrollArea } from"@/components/ui/scroll-area";
import { Badge } from"@/components/ui/badge";
import { Separator } from"@/components/ui/separator";
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
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuLabel,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from"@/components/ui/dropdown-menu";
import { ThemeToggle } from"@/components/theme-toggle";
import { useToast } from"@/hooks/use-toast";
import { normalizeProvider, type ProviderKind, type ClientApiSettings } from"@/lib/api-types";
import { type AdvancedSettings, type PostProcessingSettings, type PostProcessOutputFormat } from"@/lib/ocr/settings";
import {
  formatEta,
  formatFileSize,
  formatTimestamp,
  getMarkdownFromJsonPayload,
  getStructuredJsonPayload,
  normalizeMarkdownCandidate,
  parseLooseJsonObject,
  sleep,
  translatePipelineMessage,
} from "@/app/page-utils";
import ReactMarkdown from"react-markdown";

// Types
interface ProcessingFile {
 id: string;
 name: string;
 size: number;
 type: string;
 status:"pending"|"processing"|"paused"|"completed"|"error";
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
 kbExport?: KbExportFileState;
}

interface KbExportFileState {
 status:"idle"|"pending"|"success"|"error";
 chunkCount?: number;
 collectionName?: string;
 error?: string;
}

type KbEmbeddingProvider ="ollama"|"openrouter"|"openai_compat";
type KbChunkingStrategy ="fixed"|"sentence"|"paragraph";

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
 storeBaseUrl: string;
 storeApiKey: string;
 storeHasApiKey: boolean;
 storeDimensions: string;
 collectionTemplate: string;
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
 storeBaseUrl:"http://127.0.0.1:8000",
 storeApiKey:"",
 storeHasApiKey: false,
 storeDimensions:"768",
 collectionTemplate:"extracto-{jobId}",
};

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

// Server-side ClientApiSettings deliberately omits apiKey. The UI form
// state still needs an apiKey field for the password input — modeled as a
// local-only extension so the network shape and the form shape don't drift.
type ApiSettings = ClientApiSettings & { apiKey: string };

interface HistoryJobSummary {
 id: string;
 status:"QUEUED"|"PROCESSING"|"COMPLETED"|"FAILED";
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

type ProviderModelSelections = Partial<Record<ProviderKind, string>>;
type UiLanguage ="it"|"en"|"fr"|"es"|"de";

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

const DEFAULT_API_SETTINGS: ApiSettings = {
 provider:"ollama",
 apiEndpoint: DEFAULT_OLLAMA_ENDPOINT,
 apiKey:"",
 hasApiKey: false,
};

// Fallback list before first model fetch (Ollama only; Mistral is dynamic).
const OLLAMA_FALLBACK_MODELS: Model[] = [
 { id:"llama3.2-vision:latest", name:"Llama 3.2 Vision", provider:"ollama"},
 { id:"llava:latest", name:"LLaVA", provider:"ollama"},
 { id:"minicpm-v:latest", name:"MiniCPM-V", provider:"ollama"},
];

function getFallbackModelsForProvider(provider: ProviderKind): Model[] {
 return provider ==="ollama"? OLLAMA_FALLBACK_MODELS : [];
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
 const [selectedModel, setSelectedModel] = React.useState<string>(OLLAMA_FALLBACK_MODELS[0].id);
 const [models, setModels] = React.useState<Model[]>(OLLAMA_FALLBACK_MODELS);
 const [apiSettings, setApiSettings] = React.useState<ApiSettings>(DEFAULT_API_SETTINGS);
 const [apiSettingsDraft, setApiSettingsDraft] = React.useState<ApiSettings>(DEFAULT_API_SETTINGS);
 const [apiKeyDirty, setApiKeyDirty] = React.useState(false);
 const [isDragOver, setIsDragOver] = React.useState(false);
 const [isProcessing, setIsProcessing] = React.useState(false);
 const [uiLanguage, setUiLanguage] = React.useState<UiLanguage>("it");
 const [selectedFileId, setSelectedFileId] = React.useState<string | null>(null);
 const [copied, setCopied] = React.useState<"md"|"json"| null>(null);
 const [apiSettingsOpen, setApiSettingsOpen] = React.useState(false);
 const [settingsTab, setSettingsTab] = React.useState<"model"|"provider"|"ocr"|"kb"|"general"|"account">("model");
 const [viewMode, setViewMode] = React.useState<"preview"|"split"|"result">("split");
 const fileInputRef = React.useRef<HTMLInputElement>(null);
 const pdfPagePreviewCacheRef = React.useRef<Record<string, string[]>>({});
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
 const ocrSettingsLoadedRef = React.useRef(false);
 const [settings, setSettings] = React.useState<AdvancedSettings>({
 language:"auto",
 tableDetection: true,
 handwritingRecognition: false,
 preserveFormatting: true,
 customPrompt:"",
 quality: 80,
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
 const [kbDefaultsOpen, setKbDefaultsOpen] = React.useState(false);
 const [kbEmbeddingKeyDirty, setKbEmbeddingKeyDirty] = React.useState(false);
 const [kbStoreKeyDirty, setKbStoreKeyDirty] = React.useState(false);
 const [isSavingKbDefaults, setIsSavingKbDefaults] = React.useState(false);
 const kbDefaultsLoadedRef = React.useRef(false);

 const selectedFile = files.find((f) => f.id === selectedFileId);
 const selectedFileMarkdown = selectedFile?.result
 ? getMarkdownFromJsonPayload(selectedFile.result.json, selectedFile.result.text)
 :"";
 const selectedFileStructuredJson = selectedFile?.result
 ? getStructuredJsonPayload(selectedFile.result.json)
 : {};
 const selectedHistoryMarkdown = selectedHistoryJob
 ? getMarkdownFromJsonPayload(selectedHistoryJob.result, selectedHistoryJob.extractedText ||"")
 :"";
 const selectedHistoryStructuredJson = selectedHistoryJob
 ? getStructuredJsonPayload(selectedHistoryJob.result)
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
 async (values: ApiSettings) => {
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

 const values = (await apiResp.json()) as ApiSettings;
 const provider = normalizeProvider(values.provider);
 const normalizedSettings: ApiSettings = {
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
 method:"POST",
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

 const saved = (await response.json()) as ApiSettings;
 const provider = normalizeProvider(saved.provider);
 const normalizedSettings: ApiSettings = {
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

 const loadHistoryJobs = React.useCallback(async () => {
 setIsLoadingHistory(true);
 try {
 const response = await fetch("/api/jobs?limit=100", { cache:"no-store"});
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
 title: t("Caricamento cronologia non riuscito","History load failed","Échec du chargement de l'historique","Error al cargar historial","Verlauf laden fehlgeschlagen"),
 description: error instanceof Error ? error.message : t("Impossibile caricare la cronologia OCR","Unable to load OCR history","Impossible de charger l'historique OCR","No se pudo cargar el historial de OCR","OCR-Verlauf konnte nicht geladen werden"),
 variant:"destructive",
 });
 } finally {
 setIsLoadingHistory(false);
 }
 }, [toast]);

 const loadHistoryDetail = React.useCallback(async (jobId: string) => {
 setIsLoadingHistoryDetail(true);
 try {
 const response = await fetch(`/api/jobs/${jobId}`, { cache:"no-store"});
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
 title: t("Caricamento esecuzione non riuscito","Run load failed","Échec du chargement de l'exécution","Error al cargar la ejecución","Lauf laden fehlgeschlagen"),
 description: error instanceof Error ? error.message : t("Impossibile caricare l'esecuzione OCR","Unable to load OCR run","Impossible de charger l'exécution OCR","No se pudo cargar la ejecución OCR","OCR-Lauf konnte nicht geladen werden"),
 variant:"destructive",
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
 const response = await fetch(`/api/jobs/${selectedHistoryId}`, { method:"DELETE"});
 if (!response.ok) {
 const payload = (await response.json().catch(() => ({}))) as { error?: string };
 throw new Error(payload.error || `Delete failed (${response.status})`);
 }

 setSelectedHistoryJob(null);
 await loadHistoryJobs();

 toast({
 title: t("Esecuzione eliminata","Run deleted","Exécution supprimée","Ejecución eliminada","Lauf gelöscht"),
 description: t("Esecuzione OCR rimossa dalla cronologia","Past OCR run removed from history","Exécution OCR retirée de l'historique","Ejecución de OCR eliminada del historial","OCR-Lauf aus Verlauf entfernt"),
 });
 } catch (error) {
 toast({
 title: t("Eliminazione non riuscita","Delete failed","Échec de la suppression","Error al eliminar","Löschen fehlgeschlagen"),
 description: error instanceof Error ? error.message : t("Impossibile eliminare l'esecuzione OCR","Unable to delete OCR run","Impossible de supprimer l'exécution OCR","No se pudo eliminar la ejecución OCR","OCR-Lauf konnte nicht gelöscht werden"),
 variant:"destructive",
 });
 } finally {
 setIsDeletingHistory(false);
 }
 };

 const downloadHistoryResult = (type:"md"|"json") => {
 if (!selectedHistoryJob) return;
 const fileStem = selectedHistoryJob.fileName.replace(/\.[^/.]+$/,"") ||"ocr-result";

 if (type ==="md") {
 const markdown = selectedHistoryMarkdown;
 const blob = new Blob([markdown], { type:"text/markdown"});
 const url = URL.createObjectURL(blob);
 const a = document.createElement("a");
 a.href = url;
 a.download = `${fileStem}.md`;
 a.click();
 URL.revokeObjectURL(url);
 return;
 }

 const jsonValue = selectedHistoryStructuredJson;
 const blob = new Blob([JSON.stringify(jsonValue, null, 2)], { type:"application/json"});
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
 if (isUiLanguage(storedLanguage)) {
 setUiLanguage(storedLanguage);
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
 const activeIds = new Set(files.map((file) => file.id));
 for (const fileId of Object.keys(pdfPagePreviewCacheRef.current)) {
 if (!activeIds.has(fileId)) {
 delete pdfPagePreviewCacheRef.current[fileId];
 }
 }
 }, [files]);

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
 if (!historyOpen) {
 return;
 }

 if (!selectedHistoryId) {
 setSelectedHistoryJob(null);
 return;
 }

 void loadHistoryDetail(selectedHistoryId);
 }, [historyOpen, selectedHistoryId, loadHistoryDetail]);

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
 chunking?: { strategy?: KbChunkingStrategy; maxChunkSize?: number; overlap?: number; minChunkSize?: number };
 vectorStore?: { baseUrl?: string; dimensions?: number; hasApiKey?: boolean };
 collectionNameTemplate?: string;
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
 storeBaseUrl: payload.vectorStore?.baseUrl ?? DEFAULT_KB_FORM.storeBaseUrl,
 storeApiKey:"",
 storeHasApiKey: payload.vectorStore?.hasApiKey === true,
 storeDimensions: String(payload.vectorStore?.dimensions ?? DEFAULT_KB_FORM.storeDimensions),
 collectionTemplate: payload.collectionNameTemplate ?? DEFAULT_KB_FORM.collectionTemplate,
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
 },
 vectorStore: {
 kind:"chroma"as const,
 baseUrl: kbDefaultsDraft.storeBaseUrl.trim(),
 dimensions: parseInt10(kbDefaultsDraft.storeDimensions),
 ...(kbStoreKeyDirty ? { apiKey: kbDefaultsDraft.storeApiKey, replaceApiKey: true } : {}),
 },
 collectionNameTemplate: kbDefaultsDraft.collectionTemplate.trim(),
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
 updateFileById(file.id, (entry) => ({ ...entry, kbExport: { status:"pending"} }));
 try {
 const resp = await fetch("/api/kb/export", {
 method:"POST",
 headers:{"Content-Type":"application/json"},
 body: JSON.stringify({ jobId: file.jobId }),
 });
 const payload = (await resp.json().catch(() => ({}))) as {
 error?: string;
 chunkCount?: number;
 collectionName?: string;
 };
 if (!resp.ok) {
 throw new Error(payload.error || `Export failed (${resp.status})`);
 }
 updateFileById(file.id, (entry) => ({
 ...entry,
 kbExport: {
 status:"success",
 chunkCount: payload.chunkCount ?? 0,
 collectionName: payload.collectionName ??"",
 },
 }));
 toast({
 title: t("Esportato nel KB","Exported to KB","Exporté vers KB","Exportado a KB","In KB exportiert"),
 description: payload.collectionName
 ? t(
 `${payload.chunkCount ?? 0} chunk in ${payload.collectionName}`,
 `${payload.chunkCount ?? 0} chunks in ${payload.collectionName}`,
 )
 : undefined,
 });
 } catch (error) {
 const message = error instanceof Error ? error.message :"Unknown error";
 updateFileById(file.id, (entry) => ({
 ...entry,
 kbExport: { status:"error", error: message },
 }));
 toast({
 title: t("Esportazione KB non riuscita","KB export failed","Échec d'export KB","Error de exportación KB","KB-Export fehlgeschlagen"),
 description: message,
 variant:"destructive",
 });
 }
 };

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

 toast({
 title: t("File aggiunti","Files added","Fichiers ajoutés","Archivos añadidos","Dateien hinzugefügt"),
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
 const copyToClipboard = async (type:"md"|"json") => {
 if (!selectedFile?.result) return;

 const text = type ==="md"? selectedFileMarkdown
 : JSON.stringify(selectedFileStructuredJson, null, 2);
 await navigator.clipboard.writeText(text);
 setCopied(type);
 setTimeout(() => setCopied(null), 2000);

 toast({
 title: t("Copiato negli appunti","Copied to clipboard!","Copié dans le presse-papiers !","¡Copiado al portapapeles!","In Zwischenablage kopiert!"),
 description: t(`Contenuto ${type ==="md"?"Markdown":"JSON"} copiato`, `${type ==="md"?"Markdown":"JSON"} content has been copied`),
 });
 };

 // Download result
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
 description: t(`${selectedFile.name}.${type ==="md"?"md":"json"} in download`, `${selectedFile.name}.${type ==="md"?"md":"json"} is being downloaded`),
 });
 };

 // Export all as zip
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
 description: t(`${completedFiles.length} file esportati in ZIP`, `${completedFiles.length} files exported to ZIP archive`),
 });
 };

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

 updateFileById(file.id, (entry) => ({
 ...entry,
 preview: renderedPages[0],
 // Keep state light: only first page preview is kept in React state.
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
 resume = false
 ): Promise<{ jobId: string }> => {
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
 const pagePreviews = await ensurePagePreviews(file);
 if (pagePreviews.length === 0) {
 throw new Error("No image preview available for OCR");
 }

 updateFileById(file.id, (entry) => ({
 ...entry,
 status:"processing",
 progress: Math.max(entry.progress, 1),
 stage: resume ?"resuming":"queued",
 stageMessage: resume
 ? t("Ripresa dal checkpoint...","Resuming from checkpoint...","Reprise depuis le checkpoint...","Reanudando desde checkpoint...","Wird vom Checkpoint fortgesetzt...")
 : t(`In coda per OCR (${pagePreviews.length} pagine)`, `Queued for OCR (${pagePreviews.length} pages)`),
 pageCount: pagePreviews.length,
 processedPages: entry.processedPages || 0,
 etaSeconds: null,
 error: undefined,
 }));

 const startPayload = await startOrResumeOcr(file, pagePreviews, resume);
 updateFileById(file.id, (entry) => ({
 ...entry,
 jobId: startPayload.jobId,
 }));

 return pollJobUntilStopped(file.id, startPayload.jobId);
 };

 // Process files with OCR
 const processFiles = async () => {
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
 const filesToProcess = files.filter((f) => f.status ==="pending");
 let completedInRun = 0;

 for (const file of filesToProcess) {
 try {
 const result = await processSingleFile(file, false);
 if (result.status ==="completed") {
 completedInRun += 1;
 } else if (result.status ==="paused") {
 toast({
 title: t("OCR in pausa","OCR paused","OCR en pause","OCR en pausa","OCR pausiert"),
 description: t(`${file.name} messo in pausa al checkpoint. Premi Riprendi per continuare.`, `${file.name} paused at checkpoint. Click Resume to continue.`),
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
 description: t(`${completedInRun} file elaborati con successo`, `${completedInRun} file(s) processed successfully`),
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
 description: t(`${file.name} ripreso e completato con successo.`, `${file.name} resumed and finished successfully.`),
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
 {/* Header */}
 <motion.header
 initial={{ y: -16, opacity: 0 }}
 animate={{ y: 0, opacity: 1 }}
 transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
 className="sticky top-0 z-50 bg-background/75 backdrop-blur-md">
 <div className="container mx-auto px-5 h-16 flex items-center justify-between">
 <motion.div
 className="flex items-center gap-3 group"whileHover={{ scale: 1.015 }}
 transition={{ type:"spring", stiffness: 400, damping: 24 }}
 >
 <div className="relative grid place-items-center size-9 rounded-xl bg-primary/12 text-primary transition-[background-color,transform] duration-200 group-hover:bg-primary/18 group-hover:rotate-[-4deg]">
 <ScanLine className="h-4.5 w-4.5"/>
 <motion.div
 className="absolute -top-1 -right-1"animate={{ scale: [1, 1.18, 1], rotate: [0, 8, 0] }}
 transition={{ duration: 2.4, repeat: Infinity, ease:"easeInOut"}}
 >
 <Sparkles className="h-3 w-3 text-accent-foreground"/>
 </motion.div>
 </div>
 <div className="flex items-baseline gap-1">
 <span className="wordmark font-display text-2xl leading-none">Extracto</span>
 <span className="font-display italic text-2xl leading-none text-primary">.</span>
 </div>
 </motion.div>

 <div className="flex items-center gap-2">
 <Tooltip>
 <TooltipTrigger asChild>
 <motion.div whileHover={{ y: -1, scale: 1.05 }} whileTap={{ scale: 0.95 }} transition={{ duration: 0.16 }}>
 <Button
 variant="ghost"size="icon"className="group"onClick={() => {
 setApiSettingsDraft(apiSettings);
 setApiKeyDirty(false);
 setKbDefaultsDraft(kbDefaults);
 setKbEmbeddingKeyDirty(false);
 setKbStoreKeyDirty(false);
 setSettingsTab("model");
 setApiSettingsOpen(true);
 }}
 aria-label={t("Impostazioni","Settings","Paramètres","Configuración","Einstellungen")}
 >
 <Settings2 className="h-4 w-4 text-foreground/80 transition-transform duration-300 group-hover:rotate-90 group-hover:text-primary"/>
 </Button>
 </motion.div>
 </TooltipTrigger>
 <TooltipContent>{t("Impostazioni","Settings","Paramètres","Configuración","Einstellungen")}</TooltipContent>
 </Tooltip>

 <Tooltip>
 <TooltipTrigger asChild>
 <span><ThemeToggle /></span>
 </TooltipTrigger>
 <TooltipContent>{t("Cambia tema","Toggle theme","Changer de thème","Cambiar tema","Theme wechseln")}</TooltipContent>
 </Tooltip>
 </div>
 </div>
 </motion.header>

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
"Modello, parametri OCR, knowledge base, provider e account.",
"Model, OCR parameters, knowledge base, provider and account.",
"Modèle, paramètres OCR, base de connaissances, fournisseur et compte.",
"Modelo, parámetros OCR, base de conocimiento, proveedor y cuenta.",
"Modell, OCR-Parameter, Wissensdatenbank, Provider und Konto.",
 )}
 </DialogDescription>
 </DialogHeader>
 </div>

 <Tabs value={settingsTab} onValueChange={(v) => setSettingsTab(v as typeof settingsTab)} className="flex-1 min-h-0 flex flex-col gap-0">
 <div className="px-6">
 <TabsList className="w-full justify-start overflow-x-auto">
 <TabsTrigger value="model"className="gap-1.5"><Sparkles className="h-3.5 w-3.5"/>{t("Modello","Model","Modèle","Modelo","Modell")}</TabsTrigger>
 <TabsTrigger value="ocr"className="gap-1.5"><ScanLine className="h-3.5 w-3.5"/>{t("OCR","OCR","OCR","OCR","OCR")}</TabsTrigger>
 <TabsTrigger value="kb"className="gap-1.5"><Database className="h-3.5 w-3.5"/>{t("Knowledge base","Knowledge base","Base de connaissances","Base de conocimiento","Wissensdatenbank")}</TabsTrigger>
 <TabsTrigger value="provider"className="gap-1.5"><Settings2 className="h-3.5 w-3.5"/>{t("Provider","Provider","Fournisseur","Proveedor","Anbieter")}</TabsTrigger>
 <TabsTrigger value="general"className="gap-1.5"><Languages className="h-3.5 w-3.5"/>{t("Generale","General","Général","General","Allgemein")}</TabsTrigger>
 <TabsTrigger value="account"className="gap-1.5"><LogOut className="h-3.5 w-3.5"/>{t("Account","Account","Compte","Cuenta","Konto")}</TabsTrigger>
 </TabsList>
 </div>

 <ScrollArea className="flex-1 min-h-0 px-6 pb-2">
 <TabsContent value="model"className="space-y-5 mt-4">
 <SettingsSection
 title={t("Modello OCR","OCR model","Modèle OCR","Modelo OCR","OCR-Modell")}
 hint={t("Modello usato per leggere ogni pagina del documento.","Model used to read each page of the document.","Modèle utilisé pour lire chaque page.","Modelo usado para leer cada página.","Modell, das jede Seite liest.")}
 >
 <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isLoadingModels || models.length === 0}>
 <SelectTrigger className="w-full">
 <SelectValue placeholder={isLoadingModels ? t("Caricamento modelli...","Loading models...","Chargement...","Cargando...","Wird geladen...") : t("Seleziona modello","Select model","Choisir","Seleccionar","Wählen")} />
 </SelectTrigger>
 <SelectContent>
 {models.map((model) => (
 <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 {modelError ? <p className="text-[11px] text-destructive">{modelError}</p> : null}
 </SettingsSection>

 <SettingsSection
 title={t("Post-processing","Post-processing","Post-traitement","Post-procesamiento","Nachverarbeitung")}
 hint={t("Esegui un secondo passaggio modello per riformattare o estrarre dati.","Run a second model pass to reformat or extract data.","Effectuer un second passage du modèle pour reformater ou extraire des données.","Ejecuta un segundo paso para reformatear o extraer datos.","Zweiten Modell-Pass für Neuformatierung oder Datenextraktion ausführen.")}
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
"Esempio: estrai numero fattura, scadenza e totali, restituisci una tabella.",
"Example: extract invoice number, due date, totals — return one table.",
"Exemple : extraire numéro de facture, échéance, totaux — renvoyer un tableau.",
"Ejemplo: extrae número de factura, vencimiento, totales — devuelve una tabla.",
"Beispiel: Rechnungsnummer, Fälligkeit, Summen extrahieren — eine Tabelle zurückgeben.",
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

 <TabsContent value="ocr"className="space-y-5 mt-4">
 <SettingsSection
 title={t("Lingua documento","Document language","Langue du document","Idioma del documento","Dokumentsprache")}
 hint={t("Suggerimento per il modello: quale lingua aspettarsi nel documento.","Hint to the model: what language to expect in the document.","Indique au modèle la langue attendue.","Indica al modelo qué idioma esperar.","Hinweis ans Modell zur erwarteten Sprache.")}
 >
 <Select value={settings.language} onValueChange={(v) => setSettings((s) => ({ ...s, language: v }))}>
 <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
 <SelectContent>
 {LANGUAGES.map((lang) => (
 <SelectItem key={lang.code} value={lang.code}>{lang.names[uiLanguage] ?? lang.names.en}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </SettingsSection>

 <SettingsSection title={t("Comportamento estrazione","Extraction behavior","Comportement d'extraction","Comportamiento de extracción","Extraktionsverhalten")}>
 <div className="space-y-3">
 <ToggleRow
 label={t("Rilevamento tabelle","Table detection","Détection des tableaux","Detección de tablas","Tabellenerkennung")}
 hint={t("Rileva tabelle e le rende come Markdown.","Detect tables and render them as Markdown.","Détecte les tableaux et les rend en Markdown.","Detecta tablas y las convierte a Markdown.","Erkennt Tabellen und gibt sie als Markdown aus.")}
 checked={settings.tableDetection}
 onCheckedChange={(v) => setSettings((s) => ({ ...s, tableDetection: v }))}
 />
 <ToggleRow
 label={t("Riconoscimento scrittura a mano","Handwriting recognition","Reconnaissance d'écriture","Reconocimiento de escritura","Handschrifterkennung")}
 hint={t("Tenta di leggere testo manoscritto. Più lento e meno preciso.","Attempt to read handwritten text. Slower and less accurate.","Tente de lire le texte manuscrit. Plus lent et moins précis.","Intenta leer texto manuscrito. Más lento y menos preciso.","Versucht, Handschrift zu lesen. Langsamer und ungenauer.")}
 checked={settings.handwritingRecognition}
 onCheckedChange={(v) => setSettings((s) => ({ ...s, handwritingRecognition: v }))}
 />
 <ToggleRow
 label={t("Mantieni formattazione","Preserve formatting","Conserver la mise en forme","Conservar formato","Formatierung beibehalten")}
 hint={t("Conserva titoli, elenchi, spaziatura. Disattiva per testo piatto.","Preserve headings, lists, spacing. Disable for flat text.","Conserve titres, listes et espacements. Désactivez pour du texte brut.","Conserva títulos, listas y espacios. Desactiva para texto plano.","Behält Überschriften, Listen, Abstände. Aus für reinen Text.")}
 checked={settings.preserveFormatting}
 onCheckedChange={(v) => setSettings((s) => ({ ...s, preserveFormatting: v }))}
 />
 </div>
 </SettingsSection>

 <SettingsSection
 title={t("Qualità output","Output quality","Qualité de sortie","Calidad de salida","Ausgabequalität")}
 hint={t("Più alto: testo più ricco ma più lento.","Higher: richer text but slower.","Plus haut : texte plus riche mais plus lent.","Más alto: texto más rico pero más lento.","Höher: reichhaltiger, aber langsamer.")}
 right={<span className="text-xs text-muted-foreground tabular">{settings.quality}%</span>}
 >
 <Slider value={[settings.quality]} onValueChange={([v]) => setSettings((s) => ({ ...s, quality: v }))} min={50} max={100} step={10} className="py-2"/>
 </SettingsSection>

 <SettingsSection
 title={t("Istruzioni personalizzate","Custom instructions","Instructions personnalisées","Instrucciones personalizadas","Eigene Anweisungen")}
 hint={t("Aggiunte al prompt OCR per ogni pagina.","Appended to the OCR prompt for each page.","Ajoutées au prompt OCR pour chaque page.","Se añaden al prompt OCR de cada página.","Werden dem OCR-Prompt jeder Seite angehängt.")}
 >
 <Textarea
 placeholder={t("Esempio: ignora intestazioni e piè di pagina.","Example: ignore headers and footers.","Exemple : ignore en-têtes et pieds de page.","Ejemplo: ignora encabezados y pies.","Beispiel: Kopf- und Fußzeilen ignorieren.")}
 value={settings.customPrompt}
 onChange={(e) => setSettings((s) => ({ ...s, customPrompt: e.target.value }))}
 className="min-h-20 text-xs"/>
 </SettingsSection>
 </TabsContent>

 <TabsContent value="kb"className="space-y-5 mt-4">
 <p className="text-xs text-muted-foreground">
 {t(
"Configura embedding, chunking e vector store. Imposta KB_EXPORT_ENABLED=1 nel container per abilitare l'esportazione.",
"Configure embedding, chunking, and vector store. Set KB_EXPORT_ENABLED=1 on the container to enable export.",
"Configurez embedding, découpage et vector store. Activez KB_EXPORT_ENABLED=1 sur le conteneur pour activer l'export.",
"Configura embedding, chunking y vector store. Activa KB_EXPORT_ENABLED=1 en el contenedor para habilitar la exportación.",
"Konfigurieren Sie Embedding, Chunking und Vektor-Store. KB_EXPORT_ENABLED=1 setzen, um Export zu aktivieren.",
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
 <HintInfo text={t("Dimensione del vettore restituito dal modello (es. 768 per nomic-embed-text).","Vector dimensionality returned by the model (e.g. 768 for nomic-embed-text).","Dimensions du vecteur (ex. 768 pour nomic-embed-text).","Dimensión del vector (p. ej. 768 para nomic-embed-text).","Vektor-Dimension (z. B. 768 für nomic-embed-text).")} />
 </span>
 </Label>
 <Input type="number"min={1} max={32768} value={kbDefaultsDraft.embeddingDimensions} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, embeddingDimensions: e.target.value }))}/>
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Endpoint</Label>
 <Input value={kbDefaultsDraft.embeddingEndpoint} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, embeddingEndpoint: e.target.value }))} placeholder="http://127.0.0.1:11434"/>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Modello","Model","Modèle","Modelo","Modell")}</Label>
 <Input value={kbDefaultsDraft.embeddingModel} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, embeddingModel: e.target.value }))} placeholder="nomic-embed-text"/>
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
 </SelectContent>
 </Select>
 </div>
 <div className="grid grid-cols-3 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Max","Max","Max","Máx","Max")}</Label>
 <Input type="number"min={1} max={10000} value={kbDefaultsDraft.chunkingMaxSize} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingMaxSize: e.target.value }))}/>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 {t("Overlap","Overlap","Chevauchement","Solapamiento","Überlappung")}
 <HintInfo text={t("Solo strategia fissa.","Fixed strategy only.","Stratégie fixe uniquement.","Solo estrategia fija.","Nur feste Strategie.")}/>
 </span>
 </Label>
 <Input type="number"min={0} value={kbDefaultsDraft.chunkingOverlap} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingOverlap: e.target.value }))} disabled={kbDefaultsDraft.chunkingStrategy !=="fixed"}/>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 Min
 <HintInfo text={t("Solo strategie per frase / paragrafo.","Sentence / paragraph strategies only.","Stratégies phrase / paragraphe uniquement.","Solo estrategias por frase / párrafo.","Nur Satz- / Absatz-Strategien.")}/>
 </span>
 </Label>
 <Input type="number"min={0} value={kbDefaultsDraft.chunkingMinSize} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, chunkingMinSize: e.target.value }))} disabled={kbDefaultsDraft.chunkingStrategy ==="fixed"}/>
 </div>
 </div>
 </div>
 </SettingsSection>

 <SettingsSection title={t("Vector store","Vector store","Vector store","Vector store","Vektor-Store")}>
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Tipo","Kind","Type","Tipo","Typ")}</Label>
 <Input value="chroma"disabled />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">{t("Dimensioni","Dimensions","Dimensions","Dimensiones","Dimensionen")}</Label>
 <Input type="number"min={1} max={32768} value={kbDefaultsDraft.storeDimensions} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, storeDimensions: e.target.value }))}/>
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">Base URL</Label>
 <Input value={kbDefaultsDraft.storeBaseUrl} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, storeBaseUrl: e.target.value }))} placeholder="http://127.0.0.1:8000"/>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">API key</Label>
 <Input
 type="password"
 value={kbDefaultsDraft.storeApiKey}
 onChange={(e) => { setKbStoreKeyDirty(true); setKbDefaultsDraft((p) => ({ ...p, storeApiKey: e.target.value })); }}
 placeholder={!kbStoreKeyDirty && kbDefaultsDraft.storeHasApiKey ? t("Salvata (nascosta)","Saved (hidden)","Enregistrée (masquée)","Guardada (oculta)","Gespeichert (verborgen)") :""}
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs uppercase tracking-wider text-muted-foreground/80">
 <span className="inline-flex items-center gap-1">
 {t("Nome collezione","Collection name","Nom collection","Nombre colección","Sammlungsname")}
 <HintInfo text={t("Sostituzioni: {jobId}, {fileName}.","Substitutions: {jobId}, {fileName}.","Substitutions : {jobId}, {fileName}.","Sustituciones: {jobId}, {fileName}.","Ersetzungen: {jobId}, {fileName}.")}/>
 </span>
 </Label>
 <Input value={kbDefaultsDraft.collectionTemplate} onChange={(e) => setKbDefaultsDraft((p) => ({ ...p, collectionTemplate: e.target.value }))} placeholder="extracto-{jobId}"/>
 </div>
 </div>
 </SettingsSection>

 <div className="flex justify-end pt-2">
 <Button onClick={saveKbDefaults} disabled={isSavingKbDefaults}>
 {isSavingKbDefaults ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/> : null}
 {t("Salva knowledge base","Save knowledge base","Enregistrer KB","Guardar KB","KB speichern")}
 </Button>
 </div>
 </TabsContent>

 <TabsContent value="provider"className="space-y-5 mt-4">
 <SettingsSection title={t("Provider","Provider","Fournisseur","Proveedor","Anbieter")} hint={t("Da dove arriva l'inferenza OCR.","Where the OCR inference runs.","D'où vient l'inférence OCR.","De dónde viene la inferencia OCR.","Wo die OCR-Inferenz läuft.")}>
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
 {isSavingApiSettings ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/> : null}
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

 <SettingsSection title={t("Esecuzioni passate","Past runs","Exécutions passées","Ejecuciones pasadas","Frühere Läufe")} hint={t("Sfoglia, scarica ed elimina lavori OCR precedenti.","Browse, download, and delete previous OCR runs.","Parcourez, téléchargez et supprimez les exécutions passées.","Explora, descarga y elimina ejecuciones anteriores.","Frühere OCR-Läufe durchsuchen, herunterladen oder löschen.")}>
 <Button variant="secondary"className="w-full justify-start group"onClick={() => { setApiSettingsOpen(false); openHistoryModal(); }}>
 <History className="h-4 w-4 mr-2 text-primary transition-transform duration-200 group-hover:-rotate-6"/>
 {t("Apri cronologia","Open history","Ouvrir l'historique","Abrir historial","Verlauf öffnen")}
 </Button>
 </SettingsSection>
 </TabsContent>

 <TabsContent value="account"className="space-y-5 mt-4">
 <SettingsSection title={t("Account","Account","Compte","Cuenta","Konto")}>
 <Button variant="outline"className="w-full justify-start group"onClick={signOut} disabled={isSigningOut}>
 {isSigningOut ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : <LogOut className="h-4 w-4 mr-2 text-destructive transition-transform duration-200 group-hover:translate-x-0.5"/>}
 {t("Esci","Sign out","Se déconnecter","Cerrar sesión","Abmelden")}
 </Button>
 </SettingsSection>
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
 <DialogTitle>{t("Esecuzioni OCR passate","Past OCR Runs","Exécutions OCR précédentes","Ejecuciones OCR anteriores","Frühere OCR-Läufe")}</DialogTitle>
 <DialogDescription>
 {t("Sfoglia le esecuzioni precedenti, visualizza output, scarica o elimina.","Browse previous OCR runs, inspect output, download, or delete saved runs.","Parcourez les exécutions précédentes, inspectez la sortie, téléchargez ou supprimez.","Explora ejecuciones anteriores, inspecciona la salida, descarga o elimina.","Frühere OCR-Läufe durchsuchen, Ausgaben prüfen, herunterladen oder löschen.")}
 </DialogDescription>
 </DialogHeader>

 <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 flex-1 min-h-0 min-w-0 overflow-y-auto lg:overflow-hidden">
 <Card className="min-h-0 min-w-0 flex flex-col">
 <CardHeader className="py-3 px-4">
 <CardTitle className="text-sm">{t("Cronologia","History","Historique","Historial","Verlauf")}</CardTitle>
 </CardHeader>
 <CardContent className="p-0 flex-1 min-h-0">
 {isLoadingHistory ? (
 <div className="h-full flex items-center justify-center">
 <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
 </div>
 ) : historyJobs.length === 0 ? (
 <div className="h-full flex items-center justify-center p-4 text-center">
 <p className="text-sm text-muted-foreground">{t("Nessuna esecuzione OCR salvata.","No OCR runs saved yet.","Aucune exécution OCR enregistrée.","Aún no hay ejecuciones OCR guardadas.","Noch keine OCR-Läufe gespeichert.")}</p>
 </div>
 ) : (
 <ScrollArea className="h-full">
 <div className="p-2 space-y-1">
 {historyJobs.map((job) => (
 <motion.button
 key={job.id}
 type="button"onClick={() => setSelectedHistoryId(job.id)}
 whileHover={{ x: 2, scale: 1.01 }}
 whileTap={{ scale: 0.99 }}
 transition={{ duration: 0.15 }}
 className={cn(
"w-full text-left p-2 rounded-md transition-colors",
 selectedHistoryId === job.id
 ?"bg-primary/10":"hover:bg-muted")}
 >
 <div className="flex items-center justify-between gap-2">
 <p className="text-xs font-medium truncate">{job.fileName}</p>
 <Badge
 variant={
 job.status ==="FAILED"?"destructive": job.status ==="COMPLETED"?"secondary":"outline"}
 className="text-[10px]">
 {job.status ==="FAILED"? t("fallito","failed","échoué","fallido","fehlgeschlagen")
 : job.status ==="COMPLETED"? t("completato","completed","terminé","completado","abgeschlossen")
 : t("in corso","running","en cours","en curso","läuft")}
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
 <CardHeader className="py-3 px-4">
 <CardTitle className="text-sm">{t("Dettagli esecuzione","Run Details","Détails de l'exécution","Detalles de la ejecución","Lauf-Details")}</CardTitle>
 </CardHeader>
 <CardContent className="p-0 flex-1 min-h-0">
 {isLoadingHistoryDetail ? (
 <div className="h-full flex items-center justify-center">
 <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
 </div>
 ) : !selectedHistoryJob ? (
 <div className="h-full flex items-center justify-center p-4 text-center">
 <p className="text-sm text-muted-foreground">{t("Seleziona un'esecuzione per vedere i dettagli.","Select a run to view details.","Sélectionnez une exécution pour voir les détails.","Selecciona una ejecución para ver los detalles.","Lauf auswählen, um Details zu sehen.")}</p>
 </div>
 ) : (
 <div className="h-full flex flex-col min-h-0 min-w-0">
 <div className="p-4 space-y-2">
 <div className="flex items-center justify-between gap-3">
 <p className="text-sm font-medium truncate">{selectedHistoryJob.fileName}</p>
 <Badge
 variant={
 selectedHistoryJob.status ==="FAILED"?"destructive": selectedHistoryJob.status ==="COMPLETED"?"secondary":"outline"}
 >
 {selectedHistoryJob.status ==="FAILED"? t("fallito","failed","échoué","fallido","fehlgeschlagen")
 : selectedHistoryJob.status ==="COMPLETED"? t("completato","completed","terminé","completado","abgeschlossen")
 : t("in corso","running","en cours","en curso","läuft")}
 </Badge>
 </div>
 <p className="text-xs text-muted-foreground">{t("Modello","Model","Modèle","Modelo","Modell")}: {selectedHistoryJob.model}</p>
 <p className="text-xs text-muted-foreground">
 {t("Creato","Created","Créé","Creado","Erstellt")}: {formatTimestamp(selectedHistoryJob.createdAt)}
 </p>
 </div>

 <div className="grid xl:grid-cols-[240px_minmax(0,1fr)] flex-1 min-h-0 min-w-0">
 <div className="p-3 flex items-center justify-center bg-muted/20">
 {selectedHistoryJob.sourcePreview ? (
 <img
 src={selectedHistoryJob.sourcePreview}
 alt={selectedHistoryJob.fileName}
 className="max-h-[220px] max-w-full object-contain rounded-md"/>
 ) : (
 <div className="text-center text-muted-foreground">
 <ImageOff className="h-8 w-8 mx-auto mb-2"/>
 <p className="text-xs">{t("Anteprima non disponibile","No preview saved","Aucun aperçu enregistré","Vista previa no guardada","Keine Vorschau gespeichert")}</p>
 </div>
 )}
 </div>
 <Tabs defaultValue="markdown"className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
 <div className="px-3 pt-2">
 <TabsList className="h-8 w-full justify-start overflow-x-auto">
 <TabsTrigger value="markdown"className="text-xs h-6 shrink-0 gap-1.5 group">
 <FileText className="h-3 w-3 text-[oklch(0.62_0.13_150)] transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
 Markdown
 </TabsTrigger>
 <TabsTrigger value="markdown-raw"className="text-xs h-6 shrink-0 gap-1.5 group">
 <FileText className="h-3 w-3 text-lime-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
 {t("Markdown grezzo","Markdown raw","Markdown brut","Markdown sin procesar","Roh-Markdown")}
 </TabsTrigger>
 <TabsTrigger value="json"className="text-xs h-6 shrink-0 gap-1.5 group">
 <Code className="h-3 w-3 text-accent-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
 JSON
 </TabsTrigger>
 </TabsList>
 </div>
 <TabsContent value="markdown"className="flex-1 m-0 min-h-0 min-w-0">
 <ScrollArea className="h-full w-full">
 <div className="prose prose-sm dark:prose-invert max-w-none p-4 break-words [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:break-words">
 <ReactMarkdown>{selectedHistoryMarkdown}</ReactMarkdown>
 </div>
 </ScrollArea>
 </TabsContent>
 <TabsContent value="markdown-raw"className="flex-1 m-0 min-h-0 min-w-0">
 <ScrollArea className="h-full w-full">
 <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
 {selectedHistoryMarkdown}
 </pre>
 </ScrollArea>
 </TabsContent>
 <TabsContent value="json"className="flex-1 m-0 min-h-0 min-w-0">
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
 variant="outline"onClick={() => downloadHistoryResult("md")}
 disabled={!selectedHistoryJob}
 className="group">
 <Download className="h-4 w-4 mr-1.5 text-[oklch(0.62_0.13_150)] transition-transform duration-200 group-hover:-translate-y-0.5"/>
 {t("Scarica MD","Download MD","Télécharger MD","Descargar MD","MD herunterladen")}
 </Button>
 <Button
 variant="outline"onClick={() => downloadHistoryResult("json")}
 disabled={!selectedHistoryJob}
 className="group">
 <Download className="h-4 w-4 mr-1.5 text-accent-foreground transition-transform duration-200 group-hover:-translate-y-0.5"/>
 {t("Scarica JSON","Download JSON","Télécharger JSON","Descargar JSON","JSON herunterladen")}
 </Button>
 <Button
 variant="destructive"onClick={deleteHistoryJob}
 disabled={!selectedHistoryId || isDeletingHistory}
 className="group">
 {isDeletingHistory ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/> : <Trash2 className="h-4 w-4 mr-1.5 transition-transform duration-200 group-hover:scale-110"/>}
 {t("Elimina esecuzione","Delete Run","Supprimer l'exécution","Eliminar ejecución","Lauf löschen")}
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
 className="flex flex-col gap-4 min-h-0 lg:overflow-y-auto lg:scrollbar-hide lg:pr-1">
 {/* Upload Area */}
 <Card
 className={cn(
"transition-all duration-300 cursor-pointer",
 isDragOver
 ?"bg-primary/5 scale-[1.02]":"")}
 onDragOver={handleDragOver}
 onDragLeave={handleDragLeave}
 onDrop={handleDrop}
 onClick={() => fileInputRef.current?.click()}
 >
 <CardContent className="flex flex-col items-center justify-center py-8 px-4">
 <motion.div
 animate={isDragOver ? { scale: 1.1, y: -5 } : { scale: 1, y: 0 }}
 transition={{ type:"spring", stiffness: 300 }}
 >
 <div className="relative">
 <Upload className="h-10 w-10 text-muted-foreground mb-3"/>
 <motion.div
 className="absolute -top-1 -right-1"animate={{ rotate: [0, 10, -10, 0] }}
 transition={{ duration: 1.5, repeat: Infinity }}
 >
 <FileUp className="h-4 w-4 text-primary"/>
 </motion.div>
 </div>
 </motion.div>
 <p className="text-sm font-medium mb-1">
 {isDragOver ? t("Rilascia qui i file","Drop files here","Déposez les fichiers ici","Suelta los archivos aquí","Dateien hier ablegen") : t("Trascina i documenti o clicca per caricare","Drop documents or click to upload","Glissez-déposez des documents ou cliquez pour téléverser","Arrastra documentos o haz clic para subir","Dokumente hier ablegen oder klicken, um hochzuladen")}
 </p>
 <p className="text-xs text-muted-foreground">
 {t("Supporta immagini, PDF e documenti","Supports images, PDFs, and documents","Prend en charge images, PDF et documents","Admite imágenes, PDF y documentos","Unterstützt Bilder, PDFs und Dokumente")}
 </p>
 </CardContent>
 </Card>

 <input
 ref={fileInputRef}
 type="file"multiple
 accept="image/*,.pdf,.doc,.docx"className="hidden"onChange={(e) => e.target.files && handleFiles(e.target.files)}
 />

 {/* File List */}
 <Card className="min-h-[220px] overflow-hidden">
 <CardContent className="p-0 flex flex-col">
 {/* File List Header */}
 <div className="flex items-center justify-between p-3">
 <div className="flex items-center gap-2">
 <FileText className="h-4 w-4 text-primary"/>
 <span className="text-sm font-medium">
 {files.length} {t(files.length !== 1 ?"file":"file", files.length !== 1 ?"files":"file")}
 </span>
 {completedCount > 0 && (
 <Badge variant="secondary"className="text-xs">
 <CheckCircle2 className="h-3 w-3 mr-1"/>
 {t(`${completedCount} completati`, `${completedCount} done`)}
 </Badge>
 )}
 {errorCount > 0 && (
 <Badge variant="destructive"className="text-xs">
 <AlertCircle className="h-3 w-3 mr-1"/>
 {t(`${errorCount} falliti`, `${errorCount} failed`)}
 </Badge>
 )}
 </div>
 {files.length > 0 && (
 <Button
 variant="ghost"size="sm"className="h-7 text-xs text-muted-foreground hover:text-destructive group"onClick={clearAllFiles}
 >
 <Trash2 className="h-3 w-3 mr-1 transition-transform duration-200 group-hover:scale-110"/>
 {t("Pulisci","Clear","Effacer","Limpiar","Leeren")}
 </Button>
 )}
 </div>

 {/* File List Items or Empty State */}
 {files.length > 0 ? (
 <ScrollArea className="max-h-[220px]">
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
 ?"bg-primary/10":"hover:bg-muted/50")}
 onClick={() => setSelectedFileId(file.id)}
 >
 {/* Preview or Icon */}
 <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
 {file.preview ? (
 <img
 src={file.preview}
 alt={file.name}
 className="w-full h-full object-cover"/>
 ) : (
 <FileText className="h-5 w-5 text-muted-foreground"/>
 )}
 </div>

 {/* File Info */}
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium truncate">{file.name}</p>
 <div className="flex items-center gap-2">
 <span className="text-xs text-muted-foreground">
 {formatFileSize(file.size)}
 </span>
 {typeof file.pageCount ==="number"? (
 <span className="text-[11px] text-muted-foreground">
 {file.pageCount} {t(file.pageCount === 1 ?"pagina":"pagine", file.pageCount === 1 ?"page":"pages")}
 </span>
 ) : null}
 {file.status ==="processing"&& (
 <div className="flex items-center gap-1">
 <Loader2 className="h-3 w-3 animate-spin text-primary"/>
 <span className="text-xs text-primary">{file.progress}%</span>
 </div>
 )}
 {file.status ==="paused"? (
 <div className="flex items-center gap-1">
 <PauseCircle className="h-3 w-3 text-accent-foreground"/>
 <span className="text-xs text-accent-foreground">{t("in pausa","paused","en pause","en pausa","pausiert")}</span>
 </div>
 ) : null}
 </div>
 {(file.status ==="processing"|| file.status ==="paused") && (
 <>
 <Progress value={file.progress} className="h-1 mt-1"/>
 <div className="flex items-center justify-between mt-1">
 <span className="text-[11px] text-muted-foreground truncate max-w-[150px]">
 {translatePipelineMessage(file.stageMessage, uiLanguage) || (file.status ==="paused"? t("In pausa","Paused","En pause","En pausa","Pausiert") : t("In lavorazione","Working","En cours","Trabajando","In Arbeit"))}
 </span>
 <span className="text-[11px] text-muted-foreground">
 {t("ETA","ETA","ETA","ETA","ETA")} {formatEta(file.etaSeconds)}
 </span>
 </div>
 </>
 )}
 </div>

 {/* Status Icon */}
 <div className="flex-shrink-0">
 {file.status ==="completed"&& (
 <motion.div
 initial={{ scale: 0 }}
 animate={{ scale: 1 }}
 transition={{ type:"spring", stiffness: 400 }}
 >
 <CheckCircle2 className="h-4 w-4 text-[oklch(0.55_0.13_150)]"/>
 </motion.div>
 )}
 {file.status ==="error"&& (
 <AlertCircle className="h-4 w-4 text-destructive"/>
 )}
 {file.status ==="paused"&& (
 <PauseCircle className="h-4 w-4 text-accent-foreground"/>
 )}
 {file.status ==="pending"&& (
 <Button
 variant="ghost"size="icon"className="h-6 w-6"onClick={(e) => {
 e.stopPropagation();
 removeFile(file.id);
 }}
 >
 <X className="h-3 w-3"/>
 </Button>
 )}
 </div>
 </motion.div>
 ))}
 </AnimatePresence>
 </div>
 </ScrollArea>
 ) : (
 <div className="flex items-center justify-center py-8 min-h-[120px]">
 <div className="text-center">
 <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
 <FileText className="h-6 w-6 text-muted-foreground"/>
 </div>
 <p className="text-sm font-medium">{t("Nessun file","No files yet","Aucun fichier","Sin archivos aún","Noch keine Dateien")}</p>
 <p className="text-xs text-muted-foreground">
 {t("Carica documenti per iniziare","Upload documents to start","Téléversez des documents pour commencer","Sube documentos para empezar","Dokumente hochladen, um zu starten")}
 </p>
 </div>
 </div>
 )}

 <div className="p-3 space-y-2 bg-card">
 {activeProcessingFile ? (
 <Button
 variant="destructive"className="w-full group"onClick={() => stopProcessingFile(activeProcessingFile)}
 >
 <PauseCircle className="h-4 w-4 mr-2 transition-transform duration-200 group-hover:scale-110"/>
 {t("Ferma OCR corrente","Stop current OCR","Arrêter l'OCR en cours","Detener OCR actual","Aktuelle OCR stoppen")}
 </Button>
 ) : (
 <Button
 className="w-full group"onClick={processFiles}
 disabled={isProcessing || pendingCount === 0 || !selectedModel.trim() || !isRunReady}
 >
 {isProcessing ? (
 <>
 <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
 {t("Avvio in corso...","Starting...","Démarrage...","Iniciando...","Wird gestartet...")}
 </>
 ) : (
 <>
 <Zap className="h-4 w-4 mr-2 transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6"/>
 {t(`Avvia OCR (${pendingCount} in attesa)`, `Run OCR (${pendingCount} pending)`,`Lancer OCR (${pendingCount} en attente)`,`Iniciar OCR (${pendingCount} pendientes)`,`OCR starten (${pendingCount} ausstehend)`)}
 </>
 )}
 </Button>
 )}
 {resumableSelectedFile && !activeProcessingFile ? (
 <Button
 variant="secondary"className="w-full group"onClick={() => resumeProcessingFile(resumableSelectedFile)}
 >
 <PlayCircle className="h-4 w-4 mr-2 text-[oklch(0.62_0.13_150)] transition-transform duration-200 group-hover:scale-110"/>
 {t("Riprendi dal checkpoint","Resume from checkpoint","Reprendre depuis le checkpoint","Reanudar desde checkpoint","Vom Checkpoint fortsetzen")}
 </Button>
 ) : null}
 <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
 <span className="truncate">
 <span className="text-muted-foreground/70">{t("Modello","Model","Modèle","Modelo","Modell")}: </span>
 <span className="text-foreground/90 font-medium tabular">{models.find((m) => m.id === selectedModel)?.name || selectedModel || "—"}</span>
 </span>
 {canExportZip ? (
 <Tooltip>
 <TooltipTrigger asChild>
 <button type="button"onClick={exportAllAsZip} className="inline-flex items-center gap-1 text-foreground/70 hover:text-primary transition-colors">
 <FileArchive className="h-3 w-3"/>
 <span>ZIP</span>
 </button>
 </TooltipTrigger>
 <TooltipContent>{t("Esporta tutti i risultati","Export all results","Exporter tous les résultats","Exportar todos los resultados","Alle Ergebnisse exportieren")}</TooltipContent>
 </Tooltip>
 ) : null}
 </div>
 </div>
 </CardContent>
 </Card>

 </motion.div>

 {/* Right Panel - Preview */}
 <motion.div
 initial={{ x: 20, opacity: 0 }}
 animate={{ x: 0, opacity: 1 }}
 transition={{ duration: 0.4, delay: 0.2 }}
 className="flex flex-col min-h-[500px] lg:min-h-0">
 {selectedFile ? (
 <Card className="flex-1 flex flex-col min-h-0">
 <CardContent className="flex-1 flex flex-col p-0 min-h-0">
 {/* Preview Header */}
 <div className="flex items-center justify-between p-3">
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium truncate max-w-[180px]">
 {selectedFile.name}
 </span>
 {selectedFile.status ==="completed"&& (
 <Badge variant="outline"className="text-xs">
 <CheckCircle2 className="h-3 w-3 mr-1 text-[oklch(0.55_0.13_150)]"/>
 {t("Completato","Completed","Terminé","Completado","Abgeschlossen")}
 </Badge>
 )}
 {selectedFile.status ==="paused"&& (
 <Badge variant="outline"className="text-xs">
 <PauseCircle className="h-3 w-3 mr-1 text-accent-foreground"/>
 {t("In pausa","Paused","En pause","En pausa","Pausiert")}
 </Badge>
 )}
 </div>
 <div className="flex items-center gap-1">
 {selectedFile.result && (
 <>
 <div className="surface-soft rounded-xl p-0.5 flex items-center gap-0.5">
 <Tooltip>
 <TooltipTrigger asChild>
 <button type="button"onClick={() => setViewMode("preview")} className={cn("inline-flex items-center justify-center size-7 rounded-lg transition-colors", viewMode ==="preview"?"bg-card text-foreground shadow-[var(--shadow-soft)]":"text-muted-foreground/80 hover:text-foreground")}>
 <Eye className="h-3.5 w-3.5"/>
 </button>
 </TooltipTrigger>
 <TooltipContent>{t("Anteprima","Preview","Aperçu","Vista previa","Vorschau")}</TooltipContent>
 </Tooltip>
 <Tooltip>
 <TooltipTrigger asChild>
 <button type="button"onClick={() => setViewMode("split")} className={cn("inline-flex items-center justify-center size-7 rounded-lg transition-colors", viewMode ==="split"?"bg-card text-foreground shadow-[var(--shadow-soft)]":"text-muted-foreground/80 hover:text-foreground")}>
 <Columns className="h-3.5 w-3.5"/>
 </button>
 </TooltipTrigger>
 <TooltipContent>{t("Doppia colonna","Split view","Vue partagée","Vista dividida","Geteilte Ansicht")}</TooltipContent>
 </Tooltip>
 <Tooltip>
 <TooltipTrigger asChild>
 <button type="button"onClick={() => setViewMode("result")} className={cn("inline-flex items-center justify-center size-7 rounded-lg transition-colors", viewMode ==="result"?"bg-card text-foreground shadow-[var(--shadow-soft)]":"text-muted-foreground/80 hover:text-foreground")}>
 <FileText className="h-3.5 w-3.5"/>
 </button>
 </TooltipTrigger>
 <TooltipContent>{t("Risultato","Result only","Résultat","Resultado","Ergebnis")}</TooltipContent>
 </Tooltip>
 </div>

 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost"size="sm"className="h-7 gap-1 group">
 <span className="text-xs">{t("Azioni","Actions","Actions","Acciones","Aktionen")}</span>
 <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground/80 transition-transform duration-200 group-hover:scale-110"/>
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end"className="min-w-[14rem]">
 <DropdownMenuLabel>{t("Copia","Copy","Copier","Copiar","Kopieren")}</DropdownMenuLabel>
 <DropdownMenuItem onSelect={() => copyToClipboard("md")}>
 {copied ==="md"? <Check className="text-primary"/> : <Copy />}
 <span>{t("Copia Markdown","Copy Markdown","Copier Markdown","Copiar Markdown","Markdown kopieren")}</span>
 </DropdownMenuItem>
 <DropdownMenuItem onSelect={() => copyToClipboard("json")}>
 {copied ==="json"? <Check className="text-primary"/> : <Copy />}
 <span>{t("Copia JSON","Copy JSON","Copier JSON","Copiar JSON","JSON kopieren")}</span>
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuLabel>{t("Scarica","Download","Télécharger","Descargar","Herunterladen")}</DropdownMenuLabel>
 <DropdownMenuItem onSelect={() => downloadResult("md")}>
 <Download />
 <span>{t("Scarica Markdown","Download Markdown","Télécharger Markdown","Descargar Markdown","Markdown herunterladen")}</span>
 </DropdownMenuItem>
 <DropdownMenuItem onSelect={() => downloadResult("json")}>
 <Download />
 <span>{t("Scarica JSON","Download JSON","Télécharger JSON","Descargar JSON","JSON herunterladen")}</span>
 </DropdownMenuItem>
 {selectedFile.status ==="completed"&& selectedFile.jobId ? (
 <>
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onSelect={() => exportFileToKb(selectedFile)}
 disabled={selectedFile.kbExport?.status ==="pending"}
 >
 {selectedFile.kbExport?.status ==="pending"? <Loader2 className="animate-spin text-primary"/>
 : selectedFile.kbExport?.status ==="success"? <Database className="text-primary"/>
 : <DatabaseBackup />}
 <span>
 {selectedFile.kbExport?.status ==="success"
 ? t("Riesporta verso KB","Re-export to KB","Réexporter vers KB","Reexportar a KB","Erneut in KB exportieren")
 : t("Invia al vector store","Send to vector store","Envoyer au vector store","Enviar al vector store","An Vektor-Store senden")}
 </span>
 </DropdownMenuItem>
 </>
 ) : null}
 </DropdownMenuContent>
 </DropdownMenu>
 </>
 )}
 </div>
 </div>

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
 <FileText className="h-3 w-3 text-[oklch(0.62_0.13_150)] transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
 Markdown
 </TabsTrigger>
 <TabsTrigger value="markdown-raw"className="text-xs gap-1.5 h-6 shrink-0 group">
 <FileText className="h-3 w-3 text-lime-400 transition-transform duration-200 group-hover:-translate-y-0.5 group-data-[state=active]:scale-110"/>
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
 <ReactMarkdown>{selectedFileMarkdown}</ReactMarkdown>
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
 <ListChecks className="h-3.5 w-3.5"/>
 <span>
 {selectedFile.processedPages || 0}/{selectedFile.pageCount || 0} {t("pagine","pages","pages","páginas","Seiten")}
 </span>
 </div>
 <div className="flex items-center gap-1.5">
 <Clock3 className="h-3.5 w-3.5"/>
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
 processed ?"bg-emerald-50/20":"")}
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
 className="rounded bg-muted/20 p-2">
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
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
 <AlertCircle className="h-8 w-8 text-destructive"/>
 </div>
 <p className="text-sm font-medium mb-1">{t("Elaborazione non riuscita","Processing Failed","Échec du traitement","Procesamiento fallido","Verarbeitung fehlgeschlagen")}</p>
 <p className="text-xs text-muted-foreground max-w-xs">
 {selectedFile.error || t("Si è verificato un errore durante l'elaborazione OCR","An error occurred during OCR processing","Une erreur est survenue pendant le traitement OCR","Ocurrió un error durante el procesamiento OCR","Beim OCR-Vorgang ist ein Fehler aufgetreten")}
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
 className="max-w-full max-h-[400px] object-contain rounded-md shadow-sm mb-4"/>
 <p className="text-sm font-medium mb-1">{t("Pronto per OCR","Ready for OCR","Prêt pour l'OCR","Listo para OCR","Bereit für OCR")}</p>
 <p className="text-xs text-muted-foreground">
 {t('Clicca"Avvia OCR"per estrarre il testo da questo documento', 'Click"Run OCR"to extract text from this document')}
 </p>
 </div>
 ) : (
 <motion.div
 initial={{ opacity: 0, y: 10 }}
 animate={{ opacity: 1, y: 0 }}
 className="text-center">
 <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
 <ScanLine className="h-8 w-8 text-muted-foreground"/>
 </div>
 <p className="text-sm font-medium mb-1">{t("Pronto per OCR","Ready for OCR","Prêt pour l'OCR","Listo para OCR","Bereit für OCR")}</p>
 <p className="text-xs text-muted-foreground">
 {t('Clicca"Avvia OCR"per estrarre il testo', 'Click"Run OCR"to extract text')}
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
 <Sparkles className="h-10 w-10 text-primary"/>
 </div>
 <h3 className="text-lg font-semibold mb-2">{t("Seleziona un documento","Select a document","Choisir un document","Selecciona un documento","Dokument wählen")}</h3>
 <p className="text-sm text-muted-foreground max-w-xs mx-auto">
 {t("Carica file e selezionane uno per vedere il risultato OCR","Upload files and select one to view the OCR extraction results","Téléversez des fichiers et sélectionnez-en un pour voir le résultat OCR","Sube archivos y selecciona uno para ver el resultado del OCR","Dateien hochladen und eine auswählen, um das OCR-Ergebnis zu sehen")}
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
 className="mt-auto">
 <div className="container mx-auto px-5 h-14 flex items-center justify-between gap-3">
 <p className="text-xs text-muted-foreground">
 © {new Date().getFullYear()}{" "}
 <span className="font-display italic font-medium text-foreground/80">Extracto</span>{" "}
 {t("di","by","par","por","von")}{" "}
 <a
 href="https://github.com/codelined-ag"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 text-foreground/80 hover:text-primary transition-colors group"
 >
 <span className="font-medium">codelined</span>
 <Github className="h-3 w-3 transition-transform duration-200 group-hover:rotate-6 group-hover:scale-110"/>
 </a>
 </p>
 <a
 href="https://github.com/codelined-ag"
 target="_blank"
 rel="noopener noreferrer"
 className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 hover:text-primary transition-colors"
 >
 {t("github","github","github","github","github")}
 </a>
 </div>
 </motion.footer>
 </div>
 );
}

function SettingsSection({ title, hint, right, children }: { title: React.ReactNode; hint?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
 return (
 <div className="space-y-2">
 <div className="flex items-baseline justify-between gap-3">
 <div>
 <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
 {hint ? <p className="text-[12px] text-muted-foreground/90 leading-relaxed mt-0.5">{hint}</p> : null}
 </div>
 {right ? <div className="shrink-0">{right}</div> : null}
 </div>
 <div>{children}</div>
 </div>
 );
}

function ToggleRow({ label, hint, checked, onCheckedChange }: { label: string; hint?: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
 return (
 <div className="flex items-center justify-between gap-4 surface-soft rounded-xl px-3.5 py-2.5">
 <div className="min-w-0">
 <Label className="text-sm font-medium">
 <span className="inline-flex items-center gap-1.5">
 {label}
 {hint ? <HintInfo text={hint} /> : null}
 </span>
 </Label>
 </div>
 <Switch checked={checked} onCheckedChange={onCheckedChange} />
 </div>
 );
}

function HintInfo({ text }: { text: string }) {
 return (
 <Tooltip>
 <TooltipTrigger asChild>
 <button type="button"className="text-muted-foreground/60 hover:text-foreground transition-colors"aria-label="info">
 <Info className="h-3 w-3"/>
 </button>
 </TooltipTrigger>
 <TooltipContent>{text}</TooltipContent>
 </Tooltip>
 );
}

function ChevronDown({ className }: { className?: string }) {
 return (
 <svg
 xmlns="http://www.w3.org/2000/svg"viewBox="0 0 24 24"fill="none"stroke="currentColor"strokeWidth="2"strokeLinecap="round"strokeLinejoin="round"className={className}
 >
 <path d="m6 9 6 6 6-6"/>
 </svg>
 );
}
