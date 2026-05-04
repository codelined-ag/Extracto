"use client";

import type { ProcessingFile } from "@/app/page-components/types";

const DB_NAME = "extracto-queue";
const DB_VERSION = 2;
const STORE_NAME = "files";
const PAGES_STORE = "pages";
const SCHEMA_VERSION = 1;

interface PersistedRecord {
  id: string;
  schemaVersion: number;
  savedAt: number;
  file: SerializableProcessingFile;
}

type SerializableProcessingFile = Omit<ProcessingFile, "file"> & { _hadFile?: boolean };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PAGES_STORE)) {
        db.createObjectStore(PAGES_STORE, { keyPath: "fileId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
  return dbPromise;
}

interface PagesRecord {
  fileId: string;
  pages: string[];
  savedAt: number;
}

export async function persistPagePreviews(fileId: string, pages: string[]): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: true };
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const tx = db.transaction(PAGES_STORE, "readwrite");
  const record: PagesRecord = { fileId, pages, savedAt: Date.now() };
  tx.objectStore(PAGES_STORE).put(record);
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    tx.oncomplete = () => resolve({ ok: true });
    tx.onerror = () => {
      const message = tx.error?.message ?? "IndexedDB write failed";
      console.warn("[queue-persist] failed to save pages for", fileId, tx.error);
      resolve({ ok: false, error: message });
    };
    tx.onabort = () => resolve({ ok: false, error: tx.error?.message ?? "Transaction aborted" });
  });
}

export async function loadAllPagePreviews(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (typeof window === "undefined") return out;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return out;
  }
  const tx = db.transaction(PAGES_STORE, "readonly");
  const store = tx.objectStore(PAGES_STORE);
  return new Promise<Map<string, string[]>>((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const records = (req.result as PagesRecord[] | undefined) ?? [];
      for (const r of records) {
        if (Array.isArray(r.pages) && r.pages.length > 0) {
          out.set(r.fileId, r.pages);
        }
      }
      resolve(out);
    };
    req.onerror = () => resolve(out);
  });
}

export async function deletePagePreviews(fileId: string): Promise<void> {
  if (typeof window === "undefined") return;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }
  const tx = db.transaction(PAGES_STORE, "readwrite");
  tx.objectStore(PAGES_STORE).delete(fileId);
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function strip(file: ProcessingFile): SerializableProcessingFile {
  const { file: rawFile, ...rest } = file;
  return { ...rest, _hadFile: Boolean(rawFile) };
}

export async function persistQueue(files: ProcessingFile[]): Promise<void> {
  if (typeof window === "undefined") return;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  const now = Date.now();
  for (const f of files) {
    const record: PersistedRecord = {
      id: f.id,
      schemaVersion: SCHEMA_VERSION,
      savedAt: now,
      file: strip(f),
    };
    store.put(record);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("persistQueue failed"));
    tx.onabort = () => reject(tx.error ?? new Error("persistQueue aborted"));
  });
}

export async function loadQueue(): Promise<ProcessingFile[]> {
  if (typeof window === "undefined") return [];
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return [];
  }
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  return new Promise<ProcessingFile[]>((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const records = (req.result as PersistedRecord[] | undefined) ?? [];
      const files: ProcessingFile[] = [];
      for (const r of records) {
        if (r.schemaVersion !== SCHEMA_VERSION) continue;
        const { _hadFile: _ignored, ...rest } = r.file;
        files.push(rest as ProcessingFile);
      }
      files.sort((a, b) => a.id.localeCompare(b.id));
      resolve(files);
    };
    req.onerror = () => resolve([]);
  });
}

export async function clearQueue(): Promise<void> {
  if (typeof window === "undefined") return;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return;
  }
  const tx = db.transaction([STORE_NAME, PAGES_STORE], "readwrite");
  tx.objectStore(STORE_NAME).clear();
  tx.objectStore(PAGES_STORE).clear();
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function reconcileJobFromServer(file: ProcessingFile): Promise<ProcessingFile> {
  if (!file.jobId) return file;
  try {
    const r = await fetch(`/api/jobs/${file.jobId}`, { cache: "no-store" });
    if (!r.ok) return file;
    const payload = (await r.json()) as {
      job?: {
        status: string;
        extractedText?: string | null;
        result?: unknown;
        errorMessage?: string | null;
        metadata?: unknown;
      };
    };
    const job = payload.job;
    if (!job) return file;

    const status: ProcessingFile["status"] =
      job.status === "COMPLETED"
        ? "completed"
        : job.status === "FAILED"
          ? "error"
          : job.status === "PROCESSING"
            ? "processing"
            : "paused";

    const meta =
      job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : null;
    const progressPct = typeof meta?.progressPct === "number" ? Math.max(0, Math.min(100, Math.round(meta.progressPct as number))) : file.progress;
    const stage = typeof meta?.stage === "string" ? meta.stage : file.stage;
    const stageMessage = typeof meta?.message === "string" ? meta.message : file.stageMessage;

    const next: ProcessingFile = {
      ...file,
      status,
      progress: status === "completed" ? 100 : progressPct,
      stage,
      stageMessage,
      error: status === "error" ? job.errorMessage ?? file.error : file.error,
    };
    if (status === "completed" && typeof job.extractedText === "string") {
      next.result = {
        text: job.extractedText,
        json: (job.result && typeof job.result === "object" && !Array.isArray(job.result)
          ? (job.result as Record<string, unknown>)
          : { markdown: job.extractedText }),
      };
    }
    return next;
  } catch {
    return file;
  }
}
