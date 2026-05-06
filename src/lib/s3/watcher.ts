import { db } from "@/lib/db";
import { dispatchUserWebhooks } from "@/lib/background/webhooks";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { submitOcrJob } from "@/lib/ocr/job-submit";
import { normalizePreviewForHistory } from "@/lib/ocr/job-input-helpers";
import { getApiSettings } from "@/lib/ocr/settings-store";
import { listS3Objects, openS3Download } from "@/lib/s3/list";

const MIN_INTERVAL_SECONDS = 30;
const MAX_BYTES_PER_OBJECT = 200 * 1024 * 1024;
const SWEEP_TICK_MS = 10_000;
const MAX_CONCURRENT_SOURCES_PER_USER = 2;
const MAX_CONSECUTIVE_FAILURES = 5;

const inFlight = new Set<string>();
const inFlightPerUser = new Map<string, number>();
let started = false;
let sweepTimer: ReturnType<typeof setTimeout> | null = null;

function mimeFromKey(key: string): string {
  const ext = key.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "tif" || ext === "tiff") return "image/tiff";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "application/octet-stream";
}

interface PreloadedJobInputs {
  inputs: Awaited<ReturnType<typeof resolveOcrJobInputs>>;
}

async function ingestKey(input: {
  source: { id: string; userId: string; model: string; bucket: string };
  key: string;
  etag: string | null;
  preloaded: PreloadedJobInputs;
}): Promise<{ skipped: boolean }> {
  const { source, key, etag, preloaded } = input;

  const existing = await db.watchedS3Object.findUnique({
    where: { sourceId_key: { sourceId: source.id, key } },
    select: { etag: true },
  });
  if (existing && existing.etag === etag) return { skipped: true };

  let claimed = true;
  try {
    await db.watchedS3Object.upsert({
      where: { sourceId_key: { sourceId: source.id, key } },
      create: { sourceId: source.id, bucket: source.bucket, key, etag, jobId: null },
      update: { etag, jobId: null, ingestedAt: new Date() },
    });
  } catch {
    claimed = false;
  }
  if (!claimed) return { skipped: true };

  const reader = (await openS3Download(source.userId, key, MAX_BYTES_PER_OBJECT)).stream.getReader();
  let buf: Buffer[] | null = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES_PER_OBJECT) {
        await reader.cancel().catch(() => undefined);
        buf = null;
        throw new Error(`Object exceeds ${MAX_BYTES_PER_OBJECT} bytes`);
      }
      buf.push(Buffer.from(value));
    }
  } catch (err) {
    await db.watchedS3Object
      .delete({ where: { sourceId_key: { sourceId: source.id, key } } })
      .catch(() => undefined);
    throw err;
  }
  const body = Buffer.concat(buf!);
  buf = null;
  const dataUrl = `data:${mimeFromKey(key)};base64,${body.toString("base64")}`;
  const fileName = key.split("/").pop() || key;
  const sourcePreview = normalizePreviewForHistory(dataUrl);

  let jobId: string;
  try {
    ({ jobId } = await submitOcrJob({
      ...preloaded.inputs,
      userId: source.userId,
      apiKeyId: null,
      fileName,
      model: source.model,
      inputPreviews: [dataUrl],
      sourcePreview,
      priority: -2,
    }));
  } catch (err) {
    await db.watchedS3Object
      .delete({ where: { sourceId_key: { sourceId: source.id, key } } })
      .catch(() => undefined);
    throw err;
  }

  await db.watchedS3Object.update({
    where: { sourceId_key: { sourceId: source.id, key } },
    data: { jobId },
  });

  void dispatchUserWebhooks(source.userId, "watcher.ingested", {
    source: { id: source.id, key },
    jobId,
  }).catch((err) => console.warn("[s3-watcher] webhook dispatch failed:", err));

  return { skipped: false };
}

async function pollSource(sourceId: string): Promise<void> {
  if (inFlight.has(sourceId)) return;
  inFlight.add(sourceId);
  let claimedUserId: string | null = null;
  try {
    const source = await db.watchedS3Source.findFirst({
      where: { id: sourceId, active: true },
      select: { id: true, userId: true, prefix: true, model: true, intervalSeconds: true, lastPolledAt: true, consecutiveFailures: true },
    });
    if (!source) return;
    const interval = Math.max(MIN_INTERVAL_SECONDS, source.intervalSeconds);
    if (source.lastPolledAt && Date.now() - source.lastPolledAt.getTime() < interval * 1000) return;

    const perUser = inFlightPerUser.get(source.userId) ?? 0;
    if (perUser >= MAX_CONCURRENT_SOURCES_PER_USER) return;
    inFlightPerUser.set(source.userId, perUser + 1);
    claimedUserId = source.userId;

    const storedSettings = await getApiSettings(source.userId);
    const inputs = await resolveOcrJobInputs({
      userId: source.userId,
      model: source.model,
      preloadedSettings: storedSettings,
    });

    let token: string | null | undefined;
    let processed = 0;
    let lastError: string | null = null;
    let listFailed = false;
    do {
      try {
        const result = await listS3Objects(source.userId, {
          subPrefix: source.prefix || undefined,
          continuationToken: token ?? undefined,
          pageSize: 100,
        });
        for (const item of result.items) {
          try {
            const outcome = await ingestKey({
              source: { id: source.id, userId: source.userId, model: source.model, bucket: "" },
              key: item.key,
              etag: item.etag,
              preloaded: { inputs },
            });
            if (!outcome.skipped) processed += 1;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            console.error(`[s3-watcher] ${item.key} failed:`, err);
          }
        }
        token = result.nextToken;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        listFailed = true;
        console.error(`[s3-watcher] list failed for ${sourceId}:`, err);
        token = null;
      }
    } while (token);

    const nextFailures = listFailed
      ? source.consecutiveFailures + 1
      : 0;
    const shouldDeactivate = nextFailures >= MAX_CONSECUTIVE_FAILURES;

    await db.watchedS3Source.update({
      where: { id: source.id },
      data: {
        lastPolledAt: new Date(),
        lastError: shouldDeactivate ? `${lastError} — auto-paused after ${nextFailures} failures` : lastError,
        consecutiveFailures: nextFailures,
        ...(shouldDeactivate ? { active: false } : {}),
      },
    });
    if (shouldDeactivate) {
      console.warn(`[s3-watcher] auto-paused ${source.id} after ${nextFailures} consecutive failures`);
    }
    if (processed > 0) console.log(`[s3-watcher] ${source.id} ingested ${processed} new objects`);
  } finally {
    inFlight.delete(sourceId);
    if (claimedUserId) {
      const next = (inFlightPerUser.get(claimedUserId) ?? 1) - 1;
      if (next <= 0) inFlightPerUser.delete(claimedUserId);
      else inFlightPerUser.set(claimedUserId, next);
    }
  }
}

async function pollAll(): Promise<void> {
  const sources = await db.watchedS3Source.findMany({
    where: { active: true },
    select: { id: true },
    take: 100,
  });
  for (const s of sources) {
    await pollSource(s.id).catch((err) => console.error(`[s3-watcher] pollSource ${s.id}:`, err));
  }
}

function scheduleNext(): void {
  sweepTimer = setTimeout(() => void runSweep(), SWEEP_TICK_MS);
  sweepTimer.unref?.();
}

async function runSweep(): Promise<void> {
  try { await pollAll(); } catch (err) {
    console.error("[s3-watcher] sweep failed:", err);
  }
  if (started) scheduleNext();
}

export function startS3Watcher(): void {
  if (started) return;
  if ((process.env.S3_WATCHER_ENABLED || "1").trim() === "0") {
    console.log("[s3-watcher] disabled by S3_WATCHER_ENABLED=0");
    return;
  }
  started = true;
  console.log(`[s3-watcher] enabled (sweep every ${SWEEP_TICK_MS}ms)`);
  scheduleNext();
}
