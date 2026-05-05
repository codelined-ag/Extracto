import { readdir, readFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";

import type { CloudEntry } from "@/lib/integrations/dispatch";

const SUPPORTED_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
const MIN_FILE_AGE_MS = 5_000;

function defaultRoot(): string {
  const explicit = process.env.LOCAL_WATCH_ROOT?.trim();
  if (explicit) return path.resolve(explicit);
  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  const m = dbUrl.match(/^file:(.+)$/);
  if (m) {
    const dbPath = m[1].trim();
    return path.resolve(path.dirname(dbPath), "local-watch");
  }
  return path.resolve(process.cwd(), "local-watch");
}

export function getLocalWatchRoot(): string {
  return defaultRoot();
}

export function getUserWatchRoot(userId: string): string {
  return path.join(getLocalWatchRoot(), userId);
}

export async function ensureUserWatchRoot(userId: string): Promise<string> {
  const dir = getUserWatchRoot(userId);
  await mkdir(dir, { recursive: true });
  return dir;
}

function resolveSubpath(userId: string, sub: string): string {
  const userRoot = getUserWatchRoot(userId);
  const candidate = path.resolve(userRoot, sub.replace(/^\/+/, ""));
  const userRootWithSep = userRoot.endsWith(path.sep) ? userRoot : userRoot + path.sep;
  if (candidate !== userRoot && !candidate.startsWith(userRootWithSep)) {
    throw new Error("Path escapes user watch root");
  }
  return candidate;
}

export async function listLocalFolder(userId: string, sub: string): Promise<CloudEntry[]> {
  await ensureUserWatchRoot(userId);
  const target = resolveSubpath(userId, sub);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const userRoot = getUserWatchRoot(userId);
  const out: CloudEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(target, entry.name);
    const rel = path.relative(userRoot, full);
    if (entry.isDirectory()) {
      out.push({
        kind: "folder",
        id: rel,
        name: entry.name,
        path: rel,
        size: 0,
        modified: null,
      });
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext)) continue;
    const info = await stat(full).catch(() => null);
    if (info && Date.now() - info.mtimeMs < MIN_FILE_AGE_MS) continue;
    out.push({
      kind: "file",
      id: rel,
      name: entry.name,
      path: rel,
      size: info?.size ?? 0,
      modified: info ? info.mtime.toISOString() : null,
    });
  }
  return out;
}

export async function downloadLocalFile(userId: string, remoteId: string): Promise<{
  data: Uint8Array;
  contentType: string | null;
  name: string;
}> {
  const target = resolveSubpath(userId, remoteId);
  const buf = await readFile(target);
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return { data, contentType: null, name: path.basename(target) };
}

export async function localFileFingerprint(userId: string, remoteId: string): Promise<string> {
  const target = resolveSubpath(userId, remoteId);
  const info = await stat(target);
  return `${info.mtimeMs}-${info.size}`;
}
