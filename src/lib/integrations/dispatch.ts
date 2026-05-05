import {
  downloadDropboxFile,
  listDropboxFolder,
  uploadDropboxFile,
  type DropboxEntry,
} from "@/lib/integrations/dropbox";
import {
  downloadGoogleDriveFile,
  listGoogleDriveFolder,
  uploadGoogleDriveFile,
  type DriveEntry,
} from "@/lib/integrations/google-drive";
import {
  downloadOneDriveFile,
  listOneDriveFolder,
  uploadOneDriveFile,
  type OneDriveEntry,
} from "@/lib/integrations/onedrive";

export type CloudProvider = "dropbox" | "google_drive" | "onedrive";

export const CLOUD_PROVIDERS: ReadonlyArray<CloudProvider> = ["dropbox", "google_drive", "onedrive"];

export function isCloudProvider(value: unknown): value is CloudProvider {
  return typeof value === "string" && (CLOUD_PROVIDERS as readonly string[]).includes(value);
}

export interface CloudEntry {
  kind: "file" | "folder";
  id: string;
  name: string;
  path: string;
  size: number;
  modified: string | null;
}

export interface CloudFile {
  data: Uint8Array;
  contentType: string | null;
  name: string;
}

export interface CloudUploadResult {
  path: string;
  size: number;
}

export async function listCloudFolder(
  provider: CloudProvider,
  userId: string,
  path: string,
): Promise<CloudEntry[]> {
  if (provider === "dropbox") {
    const entries = await listDropboxFolder(userId, path);
    return entries.map(mapDropbox);
  }
  if (provider === "google_drive") {
    const entries = await listGoogleDriveFolder(userId, path || "root");
    return entries.map(mapGoogleDrive);
  }
  const entries = await listOneDriveFolder(userId, path || "root");
  return entries.map(mapOneDrive);
}

export async function downloadCloudFile(
  provider: CloudProvider,
  userId: string,
  remoteId: string,
): Promise<CloudFile> {
  if (provider === "dropbox") {
    const result = await downloadDropboxFile(userId, remoteId);
    return {
      data: new Uint8Array(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength),
      contentType: result.contentType ?? null,
      name: result.name ?? remoteId.split("/").pop() ?? "file",
    };
  }
  if (provider === "google_drive") {
    const result = await downloadGoogleDriveFile(userId, remoteId);
    return {
      data: new Uint8Array(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength),
      contentType: result.contentType ?? null,
      name: result.name ?? remoteId,
    };
  }
  const result = await downloadOneDriveFile(userId, remoteId);
  return {
    data: new Uint8Array(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength),
    contentType: result.contentType ?? null,
    name: result.name ?? remoteId,
  };
}

export async function uploadCloudFile(
  provider: CloudProvider,
  userId: string,
  folder: string,
  filename: string,
  data: Uint8Array,
): Promise<CloudUploadResult> {
  if (provider === "dropbox") {
    const target = joinDropboxPath(folder, filename);
    const result = await uploadDropboxFile(userId, target, data);
    return { path: result.pathDisplay ?? target, size: result.size ?? data.byteLength };
  }
  if (provider === "google_drive") {
    const parentId = folder && folder !== "root" ? folder : null;
    const result = await uploadGoogleDriveFile({
      userId,
      parentId,
      name: filename,
      contentType: contentTypeFromName(filename),
      bytes: data,
    });
    return { path: `${parentId ?? "root"}/${result.name}`, size: result.size ?? data.byteLength };
  }
  const parentId = folder && folder !== "root" ? folder : null;
  const result = await uploadOneDriveFile({
    userId,
    parentId,
    name: filename,
    contentType: contentTypeFromName(filename),
    bytes: data,
  });
  return { path: `${parentId ?? "root"}/${result.name}`, size: result.size ?? data.byteLength };
}

function mapDropbox(entry: DropboxEntry): CloudEntry {
  return {
    kind: entry[".tag"] === "folder" ? "folder" : "file",
    id: entry.id ?? entry.path_lower ?? entry.path_display ?? entry.name,
    name: entry.name,
    path: entry.path_display ?? entry.path_lower ?? "",
    size: entry.size ?? 0,
    modified: entry.server_modified ?? entry.client_modified ?? null,
  };
}

function mapGoogleDrive(entry: DriveEntry): CloudEntry {
  const isFolder = entry.mimeType === "application/vnd.google-apps.folder";
  return {
    kind: isFolder ? "folder" : "file",
    id: entry.id,
    name: entry.name,
    path: entry.id,
    size: typeof entry.size === "string" ? Number(entry.size) || 0 : entry.size ?? 0,
    modified: entry.modifiedTime ?? null,
  };
}

function mapOneDrive(entry: OneDriveEntry): CloudEntry {
  return {
    kind: entry.folder ? "folder" : "file",
    id: entry.id,
    name: entry.name,
    path: entry.id,
    size: entry.size ?? 0,
    modified: entry.lastModifiedDateTime ?? null,
  };
}

export function joinDropboxPath(folder: string, filename: string): string {
  const sanitized = folder
    .replace(/\/+$/, "")
    .replace(/\/+/g, "/");
  if (!sanitized) return `/${filename}`;
  const prefixed = sanitized.startsWith("/") ? sanitized : `/${sanitized}`;
  return `${prefixed}/${filename}`;
}

function contentTypeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "md") return "text/markdown";
  if (ext === "json") return "application/json";
  if (ext === "txt") return "text/plain";
  if (ext === "html") return "text/html";
  if (ext === "rtf") return "application/rtf";
  if (ext === "csv") return "text/csv";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "zip") return "application/zip";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}
