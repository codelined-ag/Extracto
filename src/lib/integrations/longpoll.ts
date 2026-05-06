import { db } from "@/lib/db";
import { dropboxLongpoll, continueDropboxCursor, getInitialDropboxCursor } from "@/lib/integrations/dropbox";
import { pollSource } from "@/lib/integrations/watcher";

const SUPPORTED_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const RESTART_DELAY_MS = 30_000;
const REFRESH_INTERVAL_MS = 60_000;

interface LongpollWorker {
  sourceId: string;
  cursor: string | null;
  cancelled: boolean;
}

const workers = new Map<string, LongpollWorker>();
let started = false;

function isSupported(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTS.some((ext) => lower.endsWith(ext));
}

async function workerLoop(worker: LongpollWorker, source: { userId: string; folderPath: string }): Promise<void> {
  while (!worker.cancelled) {
    try {
      if (!worker.cursor) {
        const seed = await getInitialDropboxCursor(source.userId, source.folderPath);
        worker.cursor = seed.cursor;
        const seedHasSupported = seed.entries.some((e) => e[".tag"] === "file" && isSupported(e.name));
        if (seedHasSupported) {
          await pollSource(worker.sourceId).catch((err) =>
            console.error(`[dropbox-longpoll] seed poll failed for ${worker.sourceId}:`, err),
          );
        }
      }
      const { changes, backoff } = await dropboxLongpoll(worker.cursor);
      if (worker.cancelled) return;
      if (backoff) {
        await new Promise((r) => setTimeout(r, backoff * 1000));
        if (worker.cancelled) return;
        if (!changes) continue;
      } else if (!changes) {
        continue;
      }
      const { cursor, newEntries } = await continueDropboxCursor(source.userId, worker.cursor);
      worker.cursor = cursor;
      const hasSupportedFile = newEntries.some((e) => e.kind === "file" && isSupported(e.name));
      if (hasSupportedFile) {
        await pollSource(worker.sourceId).catch((err) =>
          console.error(`[dropbox-longpoll] poll triggered by longpoll failed for ${worker.sourceId}:`, err),
        );
      }
    } catch (err) {
      if (worker.cancelled) return;
      console.error(`[dropbox-longpoll] worker ${worker.sourceId} error, restarting in ${RESTART_DELAY_MS}ms:`, err);
      worker.cursor = null;
      await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
    }
  }
}

export async function refreshLongpollWorkers(): Promise<void> {
  if (process.env.CLOUD_PUSH_ENABLED !== "1") return;
  const sources = await db.watchedCloudFolder.findMany({
    where: { provider: "dropbox", active: true },
    select: { id: true, userId: true, folderPath: true },
  });
  const liveIds = new Set(sources.map((s) => s.id));
  for (const [id, worker] of workers) {
    if (!liveIds.has(id)) {
      worker.cancelled = true;
      workers.delete(id);
    }
  }
  for (const source of sources) {
    if (workers.has(source.id)) continue;
    const worker: LongpollWorker = { sourceId: source.id, cursor: null, cancelled: false };
    workers.set(source.id, worker);
    void workerLoop(worker, source).catch((err) => {
      console.error(`[dropbox-longpoll] worker ${source.id} crashed:`, err);
      workers.delete(source.id);
    });
  }
}

export function startLongpollWorkers(): void {
  if (started) return;
  if (process.env.CLOUD_PUSH_ENABLED !== "1") return;
  started = true;
  void refreshLongpollWorkers().catch((err) => console.error("[dropbox-longpoll] initial refresh failed", err));
  setInterval(() => {
    void refreshLongpollWorkers().catch((err) => console.error("[dropbox-longpoll] refresh failed", err));
  }, REFRESH_INTERVAL_MS).unref?.();
}

export function _stopAllLongpollWorkersForTests(): void {
  for (const worker of workers.values()) worker.cancelled = true;
  workers.clear();
  started = false;
}
