import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import { normalizeProvider } from "@/lib/api-types";
import { normalizePreviewForHistory } from "@/lib/ocr/job-input-helpers";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import { getApiSettings } from "@/lib/ocr/settings-store";

interface WatchFolderConfig {
  folder: string;
  userEmail: string;
  model: string;
  provider: string;
  intervalMs: number;
}

function getWatchFolderConfig(): WatchFolderConfig {
  const raw = Number(process.env.WATCH_FOLDER_INTERVAL_MS || "30000");
  return {
    folder: (process.env.WATCH_FOLDER || "").trim(),
    userEmail: (process.env.WATCH_FOLDER_USER_EMAIL || "").trim().toLowerCase(),
    model: (process.env.WATCH_FOLDER_MODEL || "").trim(),
    provider: (process.env.WATCH_FOLDER_PROVIDER || "").trim(),
    intervalMs: Number.isFinite(raw) && raw >= 5_000 ? raw : 30_000,
  };
}

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
  const cfg = getWatchFolderConfig();
  if (!cfg.userEmail) return null;
  return db.authUser.findUnique({
    where: { email: cfg.userEmail },
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

  const cfg = getWatchFolderConfig();
  const storedSettings = await getApiSettings(user.id);
  const preloadedSettings = cfg.provider
    ? { ...storedSettings, provider: normalizeProvider(cfg.provider) }
    : storedSettings;
  const inputs = await resolveOcrJobInputs({
    userId: user.id,
    model: cfg.model,
    preloadedSettings,
  });
  const sourcePreview = normalizePreviewForHistory(dataUrl);

  const { jobId } = await submitOcrJob({
    ...inputs,
    userId: user.id,
    apiKeyId: null,
    fileName,
    model: cfg.model,
    inputPreviews: [dataUrl],
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
  const cfg = getWatchFolderConfig();
  if (!cfg.folder) return;
  if (!cfg.userEmail || !cfg.model) {
    console.warn(
      "[watched-folder] WATCH_FOLDER set but WATCH_FOLDER_USER_EMAIL / WATCH_FOLDER_MODEL missing; skipping",
    );
    return;
  }

  const user = await findWatchUser();
  if (!user) {
    console.warn(
      `[watched-folder] no user found with email ${cfg.userEmail}; skipping this sweep`,
    );
    return;
  }

  let entries: string[] = [];
  try {
    entries = await readdir(cfg.folder);
  } catch (error) {
    console.warn(`[watched-folder] cannot read ${cfg.folder}:`, error);
    return;
  }

  for (const entry of entries) {
    if (!isSupportedFile(entry)) continue;
    const fullPath = path.join(cfg.folder, entry);
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
  }, getWatchFolderConfig().intervalMs);
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
  const cfg = getWatchFolderConfig();
  if (!cfg.folder) return;
  started = true;
  console.log(
    `[watched-folder] enabled at ${cfg.folder} (interval ${cfg.intervalMs}ms)`,
  );
  void runSweep();
}
