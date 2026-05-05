import { markdownToCsv } from "@/lib/export/csv";
import { markdownToDocx } from "@/lib/export/docx";
import { markdownToHtml } from "@/lib/export/html";
import { buildObsidianVaultZip, type ObsidianJobInput } from "@/lib/export/obsidian";
import { markdownToRtf } from "@/lib/export/rtf";
import { markdownToXlsx } from "@/lib/export/xlsx";

export const SUPPORTED_EXPORT_FORMATS = [
  "md",
  "json",
  "txt",
  "html",
  "docx",
  "rtf",
  "csv",
  "xlsx",
  "obsidian",
] as const;

export const MAX_EXPORT_INPUT_BYTES = 25 * 1024 * 1024;

export type ExportFormat = (typeof SUPPORTED_EXPORT_FORMATS)[number];

export class ExportTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Source markdown exceeds the export size limit (${limit} bytes).`);
    this.name = "ExportTooLargeError";
  }
}

export interface ExportResult {
  filename: string;
  contentType: string;
  body: Buffer;
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  obsidian: "application/zip",
};

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (SUPPORTED_EXPORT_FORMATS as readonly string[]).includes(value);
}

export interface JobExportSource {
  fileName?: string | null;
  extractedText: string;
  result?: unknown;
  jobId?: string;
  provider?: string;
  model?: string;
  createdAt?: Date | string;
  completedAt?: Date | string | null;
  sourcePreview?: string | null;
}

export async function renderJobExport(
  format: ExportFormat,
  job: JobExportSource,
): Promise<ExportResult> {
  const stem = baseName(job.fileName ?? "extracto-job");
  const filename = format === "obsidian" ? `${stem}-vault.zip` : `${stem}.${format}`;
  const contentType = CONTENT_TYPE[format];
  const md = job.extractedText ?? "";
  if (Buffer.byteLength(md, "utf-8") > MAX_EXPORT_INPUT_BYTES) {
    throw new ExportTooLargeError(MAX_EXPORT_INPUT_BYTES);
  }

  if (format === "md") {
    return { filename, contentType, body: Buffer.from(md, "utf-8") };
  }
  if (format === "json") {
    const body = JSON.stringify(job.result ?? { extractedText: md }, null, 2);
    return { filename, contentType, body: Buffer.from(body, "utf-8") };
  }
  if (format === "txt") {
    return { filename, contentType, body: Buffer.from(stripMarkdown(md), "utf-8") };
  }
  if (format === "html") {
    return { filename, contentType, body: Buffer.from(markdownToHtml(md), "utf-8") };
  }
  if (format === "rtf") {
    return { filename, contentType, body: Buffer.from(markdownToRtf(md), "utf-8") };
  }
  if (format === "csv") {
    return { filename, contentType, body: Buffer.from(markdownToCsv(md), "utf-8") };
  }
  if (format === "docx") {
    return { filename, contentType, body: await markdownToDocx(md) };
  }
  if (format === "xlsx") {
    return { filename, contentType, body: await markdownToXlsx(md) };
  }
  if (format === "obsidian") {
    const vaultInput: ObsidianJobInput = {
      jobId: job.jobId ?? "unknown",
      fileName: job.fileName ?? null,
      provider: job.provider ?? "unknown",
      model: job.model ?? "",
      createdAt: job.createdAt ?? new Date(),
      completedAt: job.completedAt ?? null,
      extractedText: md,
      result: job.result,
      sourcePreview: job.sourcePreview ?? null,
    };
    return { filename, contentType, body: await buildObsidianVaultZip(vaultInput) };
  }
  throw new Error(`Unsupported format: ${format}`);
}

function baseName(name: string): string {
  const noExt = name.replace(/\.[^./\\]+$/, "");
  const sansSeparators = noExt.replace(/[\\/:*?"<>|]+/g, "_");
  const sansLeadingDots = sansSeparators.replace(/^\.+/, "").replace(/\.{2,}/g, ".");
  const safe = sansLeadingDots.trim();
  return safe.length > 0 ? safe.slice(0, 200) : "extracto-job";
}

function stripMarkdown(md: string): string {
  return md
    .replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)\n?```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#+\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

