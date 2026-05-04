"use client";

import type { ProcessingFile } from "@/app/page-components/types";

const DB_NAME = "extracto-queue";
const DB_VERSION = 1;
const STORE_NAME = "files";
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });
  return dbPromise;
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
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
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
