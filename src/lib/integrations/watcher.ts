import { db } from "@/lib/db";
import {
  WATCHER_PROVIDERS,
  type WatcherProvider,
  downloadCloudFile,
  isCloudProvider,
  isWatcherProvider,
  listCloudFolder,
} from "@/lib/integrations/dispatch";
import {
  downloadLocalFile,
  listLocalFolder,
  localFileFingerprint,
} from "@/lib/integrations/local";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import { getApiSettings } from "@/lib/ocr/settings-store";
import { dispatchUserWebhooks } from "@/lib/background/webhooks";

const MIN_INTERVAL_SECONDS = 60;
const MAX_BYTES_PER_OBJECT = 64 * 1024 * 1024;
const SWEEP_TICK_MS = 30_000;
const MAX_CONCURRENT_SOURCES_PER_USER = 2;
const MAX_CONSECUTIVE_FAILURES = 5;
const SUPPORTED_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];

const inFlight = new Set<string>();
const inFlightPerUser = new Map<string, number>();
let started = false;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;

function isSupportedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTS.some((ext) => lower.endsWith(ext));
}

function inferMime(name: string, contentType: string | null): string {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (ct && ct !== "application/octet-stream") return ct;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

async function ingestEntry(
  source: { id: string; userId: string; provider: WatcherProvider; model: string },
  remoteId: string,
  name: string,
  rev: string | null,
): Promise<{ skipped: boolean }> {
  const existing = await db.watchedCloudObject.findUnique({
    where: { sourceId_remoteId: { sourceId: source.id, remoteId } },
    select: { rev: true },
  });
  if (existing && existing.rev === rev) return { skipped: true };

  let claimed = true;
  try {
    await db.watchedCloudObject.upsert({
      where: { sourceId_remoteId: { sourceId: source.id, remoteId } },
      create: { sourceId: source.id, remoteId, name, rev, jobId: null },
      update: { name, rev, jobId: null, ingestedAt: new Date() },
    });
  } catch {
    claimed = false;
  }
  if (!claimed) return { skipped: true };

  const downloaded = source.provider === "local"
    ? await downloadLocalFile(source.userId, remoteId)
    : isCloudProvider(source.provider)
      ? await downloadCloudFile(source.provider, source.userId, remoteId)
      : (() => { throw new Error(`Unsupported provider ${source.provider}`); })();
  if (downloaded.data.byteLength > MAX_BYTES_PER_OBJECT) {
    await db.watchedCloudObject
      .delete({ where: { sourceId_remoteId: { sourceId: source.id, remoteId } } })
      .catch(() => undefined);
    throw new Error(`object exceeds ${MAX_BYTES_PER_OBJECT} bytes`);
  }
  const mime = inferMime(name, downloaded.contentType);
  const base64 = Buffer.from(downloaded.data).toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;

  const settings = await getApiSettings(source.userId);
  const inputs = await resolveOcrJobInputs({
    userId: source.userId,
    model: source.model,
    preloadedSettings: settings,
  });

  let jobId: string;
  try {
    ({ jobId } = await submitOcrJob({
      ...inputs,
      userId: source.userId,
      apiKeyId: null,
      fileName: downloaded.name || name,
      model: source.model,
      inputPreviews: [dataUrl],
      sourcePreview: dataUrl,
      sourcePdf: mime === "application/pdf" ? dataUrl : undefined,
      priority: -2,
    }));
  } catch (err) {
    await db.watchedCloudObject
      .delete({ where: { sourceId_remoteId: { sourceId: source.id, remoteId } } })
      .catch(() => undefined);
    throw err;
  }

  await db.watchedCloudObject.update({
    where: { sourceId_remoteId: { sourceId: source.id, remoteId } },
    data: { jobId },
  });

  void dispatchUserWebhooks(source.userId, "watcher.ingested", {
    source: { id: source.id, provider: source.provider, remoteId, name },
    jobId,
  }).catch((err) => console.warn("[cloud-watcher] webhook dispatch failed:", err));

  return { skipped: false };
}

export async function pollSource(sourceId: string): Promise<void> {
  if (inFlight.has(sourceId)) return;
  inFlight.add(sourceId);
  try {
    const source = await db.watchedCloudFolder.findFirst({
      where: { id: sourceId, active: true },
      select: {
        id: true,
        userId: true,
        provider: true,
        folderPath: true,
        model: true,
        intervalSeconds: true,
        lastPolledAt: true,
        consecutiveFailures: true,
      },
    });
    if (!source) return;
    if (!isWatcherProvider(source.provider)) return;
    const interval = Math.max(MIN_INTERVAL_SECONDS, source.intervalSeconds);
    if (source.lastPolledAt && Date.now() - source.lastPolledAt.getTime() < interval * 1000) return;

    const perUser = inFlightPerUser.get(source.userId) ?? 0;
    if (perUser >= MAX_CONCURRENT_SOURCES_PER_USER) return;
    inFlightPerUser.set(source.userId, perUser + 1);

    const scrubAuthHeader = (raw: string): string =>
      raw
        .replace(/[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]")
        .replace(/"access_?token"\s*:\s*"[^"]+"/gi, '"access_token":"[redacted]"');

    let processed = 0;
    let lastError: string | null = null;
    let listFailed = false;
    try {
      const entries = source.provider === "local"
        ? await listLocalFolder(source.userId, source.folderPath)
        : await listCloudFolder(source.provider, source.userId, source.folderPath);
      for (const entry of entries) {
        if (entry.kind !== "file") continue;
        if (!isSupportedFile(entry.name)) continue;
        try {
          const rev = source.provider === "local"
            ? await localFileFingerprint(source.userId, entry.id)
            : (entry.modified ?? String(entry.size));
          const outcome = await ingestEntry(
            { id: source.id, userId: source.userId, provider: source.provider, model: source.model },
            entry.id,
            entry.name,
            rev,
          );
          if (!outcome.skipped) processed += 1;
        } catch (err) {
          lastError = scrubAuthHeader(err instanceof Error ? err.message : String(err));
          console.error(`[cloud-watcher] ${source.provider}:${entry.id} failed:`, err);
        }
      }
    } catch (err) {
      lastError = scrubAuthHeader(err instanceof Error ? err.message : String(err));
      listFailed = true;
      console.error(`[cloud-watcher] list failed for ${sourceId}:`, err);
    }

    const nextFailures = listFailed ? source.consecutiveFailures + 1 : 0;
    const shouldDeactivate = nextFailures >= MAX_CONSECUTIVE_FAILURES;
    await db.watchedCloudFolder.update({
      where: { id: source.id },
      data: {
        lastPolledAt: new Date(),
        lastError: shouldDeactivate
          ? `${lastError} (auto-paused after ${nextFailures} failures)`
          : lastError,
        consecutiveFailures: nextFailures,
        ...(shouldDeactivate ? { active: false } : {}),
      },
    });
    if (shouldDeactivate) {
      console.warn(`[cloud-watcher] auto-paused ${source.id} after ${nextFailures} consecutive failures`);
    }
    if (processed > 0) {
      console.log(`[cloud-watcher] ${source.id} ingested ${processed} new files`);
    }
  } finally {
    inFlight.delete(sourceId);
    const source = await db.watchedCloudFolder
      .findUnique({ where: { id: sourceId }, select: { userId: true } })
      .catch(() => null);
    if (source?.userId) {
      const next = (inFlightPerUser.get(source.userId) ?? 1) - 1;
      if (next <= 0) inFlightPerUser.delete(source.userId);
      else inFlightPerUser.set(source.userId, next);
    }
  }
}

async function pollAll(): Promise<void> {
  const sources = await db.watchedCloudFolder.findMany({
    where: { active: true, provider: { in: [...WATCHER_PROVIDERS] } },
    select: { id: true },
    take: 100,
  });
  for (const s of sources) {
    await pollSource(s.id).catch((err) =>
      console.error(`[cloud-watcher] pollSource ${s.id}:`, err),
    );
  }
}

function scheduleNext(): void {
  sweepTimer = setTimeout(() => void runSweep(), SWEEP_TICK_MS);
  sweepTimer.unref?.();
}

async function runSweep(): Promise<void> {
  try {
    await pollAll();
  } catch (err) {
    console.error("[cloud-watcher] sweep failed:", err);
  }
  if (started) scheduleNext();
}

export function startCloudWatcher(): void {
  if (started) return;
  if ((process.env.CLOUD_WATCHER_ENABLED || "1").trim() === "0") {
    console.log("[cloud-watcher] disabled by CLOUD_WATCHER_ENABLED=0");
    return;
  }
  started = true;
  console.log(`[cloud-watcher] enabled (sweep every ${SWEEP_TICK_MS}ms)`);
  scheduleNext();
}
