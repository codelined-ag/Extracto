import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { normalizeProvider } from "@/lib/ocr/endpoint-policy";
import {
  buildPrompt,
  normalizePreviewForHistory,
  resolveProvider,
  sanitizePostProcessing,
  submitOcrJob,
} from "@/lib/ocr/pipeline";
import { resolveMistralOcrModel } from "@/lib/ocr/providers/mistral";
import { normalizeAdvancedSettings } from "@/lib/ocr/settings";
import { getApiSettings } from "@/lib/ocr/settings-store";

const WATCH_FOLDER = (process.env.WATCH_FOLDER || "").trim();
const WATCH_FOLDER_USER_EMAIL = (process.env.WATCH_FOLDER_USER_EMAIL || "").trim().toLowerCase();
const WATCH_FOLDER_MODEL = (process.env.WATCH_FOLDER_MODEL || "").trim();
const WATCH_FOLDER_PROVIDER = (process.env.WATCH_FOLDER_PROVIDER || "").trim();
const WATCH_FOLDER_API_KEY = (process.env.WATCH_FOLDER_API_KEY || "").trim();
const WATCH_FOLDER_INTERVAL_MS = (() => {
  const raw = Number(process.env.WATCH_FOLDER_INTERVAL_MS || "30000");
  return Number.isFinite(raw) && raw >= 5_000 ? raw : 30_000;
})();
const WATCH_MIN_AGE_MS = 5_000;
const WATCH_RESULT_SUFFIX = ".extracto.json";
const WATCH_DONE_SUFFIX = ".extracto.done";
const SUPPORTED_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];

let started = false;
let running = false;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;

interface UserRef {
  id: string;
  email: string;
}

async function findWatchUser(): Promise<UserRef | null> {
  if (!WATCH_FOLDER_USER_EMAIL) return null;
  return db.authUser.findUnique({
    where: { email: WATCH_FOLDER_USER_EMAIL },
    select: { id: true, email: true },
  });
}

export function isSupportedFile(name: string): boolean {
  const lowered = name.toLowerCase();
  if (lowered.startsWith(".")) return false;
  if (lowered.endsWith(WATCH_RESULT_SUFFIX)) return false;
  if (lowered.endsWith(WATCH_DONE_SUFFIX)) return false;
  return SUPPORTED_EXTS.some((ext) => lowered.endsWith(ext));
}

async function ingestFile(filePath: string, user: UserRef): Promise<void> {
  const fileName = path.basename(filePath);
  const doneMarkerPath = `${filePath}${WATCH_DONE_SUFFIX}`;
  try {
    await stat(doneMarkerPath);
    return;
  } catch {
    // not yet processed
  }

  const buf = await readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let mime = "application/octet-stream";
  if (ext === ".pdf") mime = "application/pdf";
  else if (ext === ".png") mime = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
  else if (ext === ".webp") mime = "image/webp";
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

  // Submit directly via the pipeline helper — no HTTP-loopback to /api/ocr.
  const storedSettings = await getApiSettings(user.id);
  const settings = WATCH_FOLDER_PROVIDER
    ? { ...storedSettings, provider: normalizeProvider(WATCH_FOLDER_PROVIDER) }
    : { ...storedSettings, provider: normalizeProvider(storedSettings.provider) };
  const settingsPayload = normalizeAdvancedSettings(undefined);
  const postProcessingPayload = sanitizePostProcessing(undefined);
  const provider = resolveProvider(settings);
  const ocrModel = provider === "mistral" ? resolveMistralOcrModel(WATCH_FOLDER_MODEL) : WATCH_FOLDER_MODEL;
  const prompt = buildPrompt(settingsPayload);
  const sourcePreview = normalizePreviewForHistory(dataUrl);

  const { jobId } = await submitOcrJob({
    userId: user.id,
    apiKeyId: null, // watched-folder runs as the user via session-equivalent ingest
    fileName,
    model: WATCH_FOLDER_MODEL,
    ocrModel,
    provider,
    settings,
    settingsPayload,
    postProcessingPayload,
    inputPreviews: [dataUrl],
    prompt,
    sourcePreview,
    priority: -2,
  });

  await writeFile(
    doneMarkerPath,
    JSON.stringify({ jobId, submittedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  console.log(`[watched-folder] queued ${fileName} → ${jobId}`);
}

async function pollOnce(): Promise<void> {
  if (!WATCH_FOLDER) return;
  if (!WATCH_FOLDER_USER_EMAIL || !WATCH_FOLDER_MODEL || !WATCH_FOLDER_API_KEY) {
    console.warn(
      "[watched-folder] WATCH_FOLDER set but WATCH_FOLDER_USER_EMAIL / WATCH_FOLDER_MODEL / WATCH_FOLDER_API_KEY missing; skipping"
    );
    return;
  }

  const user = await findWatchUser();
  if (!user) {
    console.warn(
      `[watched-folder] no user found with email ${WATCH_FOLDER_USER_EMAIL}; skipping this sweep`
    );
    return;
  }

  let entries: string[] = [];
  try {
    entries = await readdir(WATCH_FOLDER);
  } catch (error) {
    console.warn(`[watched-folder] cannot read ${WATCH_FOLDER}:`, error);
    return;
  }

  for (const entry of entries) {
    if (!isSupportedFile(entry)) continue;
    const fullPath = path.join(WATCH_FOLDER, entry);
    let info;
    try {
      info = await stat(fullPath);
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    if (Date.now() - info.mtimeMs < WATCH_MIN_AGE_MS) continue;

    try {
      await ingestFile(fullPath, user);
    } catch (error) {
      console.error(`[watched-folder] ${entry} failed:`, error);
    }
  }
}

function scheduleNext(): void {
  scheduledTimer = setTimeout(() => {
    void runSweep();
  }, WATCH_FOLDER_INTERVAL_MS);
  scheduledTimer.unref?.();
}

async function runSweep(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await pollOnce();
  } finally {
    running = false;
    if (started) scheduleNext();
  }
}

export function startWatchedFolderIngestion(): void {
  if (started) return;
  if (!WATCH_FOLDER) return;
  started = true;
  console.log(
    `[watched-folder] enabled at ${WATCH_FOLDER} (interval ${WATCH_FOLDER_INTERVAL_MS}ms)`
  );
  void runSweep();
}
