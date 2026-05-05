import JSZip from "jszip";

const MAX_FILENAME_BASE_LENGTH = 240;
const FORBIDDEN_CHARS = /[\\/:#^|?*<>"\[\]]+/g;

export interface ObsidianJobInput {
  jobId: string;
  fileName: string | null;
  provider: string;
  model: string;
  createdAt: Date | string;
  completedAt?: Date | string | null;
  extractedText: string;
  result?: unknown;
  sourcePreview?: string | null;
}

export async function buildObsidianVaultZip(job: ObsidianJobInput): Promise<Buffer> {
  const zip = new JSZip();
  const baseTitle = obsidianFilename(job.fileName ?? "Extracto job");
  const datePrefix = formatDatePrefix(job.createdAt);
  const folder = `${datePrefix} ${baseTitle}`;
  const pageMarkdowns = collectPageMarkdowns(job.result, job.extractedText);
  const isMultiPage = pageMarkdowns.length > 1;

  const created = formatIsoLocal(job.createdAt);
  const modified = formatIsoLocal(job.completedAt ?? job.createdAt);

  const indexNote = renderJobIndex({
    title: baseTitle,
    fileName: job.fileName,
    pageMarkdowns,
    pageCount: pageMarkdowns.length,
    created,
    modified,
    provider: sanitizeNamespace(job.provider),
    model: sanitizeNamespace(job.model),
    jobId: job.jobId,
    sourceWikilink: hasSourceAttachment(job.sourcePreview) ? `[[attachments/${baseTitle}.${sourceExtension(job.sourcePreview)}]]` : null,
    extractedText: job.extractedText,
    isMultiPage,
  });
  zip.file(`${folder}/${baseTitle}.md`, indexNote);

  if (isMultiPage) {
    for (const page of pageMarkdowns) {
      const pageTitle = `${baseTitle} - Page ${String(page.pageNumber).padStart(2, "0")}`;
      const pageNote = renderPageNote({
        title: pageTitle,
        parent: baseTitle,
        pageNumber: page.pageNumber,
        markdown: page.markdown,
        created,
        modified,
        provider: sanitizeNamespace(job.provider),
      });
      zip.file(`${folder}/pages/${pageTitle}.md`, pageNote);
    }
  }

  const sourceAttachment = decodeSourceAttachment(job.sourcePreview, baseTitle);
  if (sourceAttachment) {
    zip.file(`${folder}/attachments/${sourceAttachment.filename}`, sourceAttachment.bytes);
  }

  return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

interface PageMarkdown {
  pageNumber: number;
  markdown: string;
}

function collectPageMarkdowns(result: unknown, fallback: string): PageMarkdown[] {
  if (result && typeof result === "object") {
    const r = result as { structured?: { pages?: unknown[] } };
    const pages = r.structured?.pages;
    if (Array.isArray(pages) && pages.length > 0) {
      const collected: PageMarkdown[] = [];
      for (const page of pages) {
        if (!page || typeof page !== "object") continue;
        const p = page as { pageNumber?: unknown; markdown?: unknown; text?: unknown };
        const pageNumber = typeof p.pageNumber === "number" ? p.pageNumber : collected.length + 1;
        const markdown =
          typeof p.markdown === "string" ? p.markdown : typeof p.text === "string" ? p.text : "";
        if (markdown) collected.push({ pageNumber, markdown });
      }
      if (collected.length > 0) return collected;
    }
  }
  return [{ pageNumber: 1, markdown: fallback }];
}

interface JobIndexInput {
  title: string;
  fileName: string | null;
  pageMarkdowns: PageMarkdown[];
  pageCount: number;
  created: string;
  modified: string;
  provider: string;
  model: string;
  jobId: string;
  sourceWikilink: string | null;
  extractedText: string;
  isMultiPage: boolean;
}

function renderJobIndex(input: JobIndexInput): string {
  const tags = [
    "ocr/imported",
    `provider/${input.provider || "unknown"}`,
  ];
  const aliases = input.fileName ? [input.fileName] : [];
  const cssclasses = ["ocr-document"];

  const frontmatter = [
    "---",
    aliases.length > 0
      ? `aliases:\n${aliases.map((a) => `  - ${quoteYaml(a)}`).join("\n")}`
      : null,
    `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`,
    `created: ${input.created}`,
    `modified: ${input.modified}`,
    input.sourceWikilink ? `source: ${quoteYaml(input.sourceWikilink)}` : null,
    `pages: ${input.pageCount}`,
    `ocr-provider: ${quoteYaml(input.provider || "unknown")}`,
    input.model ? `ocr-model: ${quoteYaml(input.model)}` : null,
    `ocr-job-id: ${quoteYaml(input.jobId)}`,
    `cssclasses:\n${cssclasses.map((c) => `  - ${c}`).join("\n")}`,
    "---",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const body: string[] = [];
  const trimmedText = input.extractedText.trim();
  const bodyHasH1 = /^#\s/.test(trimmedText);
  if (!bodyHasH1) body.push(`# ${input.title}`);

  if (input.sourceWikilink) {
    const inner = input.sourceWikilink.slice(2, -2);
    body.push("", `> Source: ![[${inner}]]`);
  }

  if (input.isMultiPage) {
    body.push("", "## Pages", "");
    for (const page of input.pageMarkdowns) {
      const num = String(page.pageNumber).padStart(2, "0");
      body.push(`- [[pages/${input.title} - Page ${num}|Page ${page.pageNumber}]]`);
    }
  } else {
    body.push("", trimmedText);
  }

  return `${frontmatter}\n\n${body.join("\n")}\n`;
}

interface PageNoteInput {
  title: string;
  parent: string;
  pageNumber: number;
  markdown: string;
  created: string;
  modified: string;
  provider: string;
}

function renderPageNote(input: PageNoteInput): string {
  const tags = ["ocr/imported", `provider/${input.provider || "unknown"}`];
  const frontmatter = [
    "---",
    `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`,
    `parent: ${quoteYaml(`[[${input.parent}]]`)}`,
    `page: ${input.pageNumber}`,
    `created: ${input.created}`,
    `modified: ${input.modified}`,
    "---",
  ].join("\n");
  return `${frontmatter}\n\n# ${input.title}\n\n${input.markdown.trim()}\n`;
}

export function obsidianFilename(name: string): string {
  const noExt = name.replace(/\.[^./\\]+$/, "");
  const sansForbidden = noExt.replace(FORBIDDEN_CHARS, " ").replace(/\s+/g, " ").trim();
  const sansDotDot = sansForbidden.replace(/\.{2,}/g, ".");
  const sansLeadingDot = sansDotDot.replace(/^\.+/, "_");
  const safe = sansLeadingDot.length > 0 ? sansLeadingDot : "Extracto job";
  return safe.slice(0, MAX_FILENAME_BASE_LENGTH);
}

function quoteYaml(value: string): string {
  if (/^[a-zA-Z0-9_/-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function sanitizeNamespace(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function formatDatePrefix(when: Date | string): string {
  const d = toDate(when);
  return d.toISOString().slice(0, 10);
}

function formatIsoLocal(when: Date | string): string {
  const d = toDate(when);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

function hasSourceAttachment(preview: string | null | undefined): boolean {
  return Boolean(decodeDataUrl(preview));
}

function sourceExtension(preview: string | null | undefined): string {
  const decoded = decodeDataUrl(preview);
  if (!decoded) return "bin";
  if (decoded.mime === "application/pdf") return "pdf";
  if (decoded.mime === "image/png") return "png";
  if (decoded.mime === "image/jpeg") return "jpg";
  if (decoded.mime === "image/webp") return "webp";
  return "bin";
}

function decodeSourceAttachment(
  preview: string | null | undefined,
  baseTitle: string,
): { filename: string; bytes: Buffer } | null {
  const decoded = decodeDataUrl(preview);
  if (!decoded) return null;
  const ext = sourceExtension(preview);
  return { filename: `${baseTitle}.${ext}`, bytes: decoded.bytes };
}

function decodeDataUrl(value: string | null | undefined): { mime: string; bytes: Buffer } | null {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^data:([^;,]+)(?:;base64)?,([\s\S]*)$/);
  if (!match) return null;
  const mime = match[1];
  const payload = match[2];
  const isBase64 = value.includes(";base64,");
  try {
    let bytes: Buffer;
    if (isBase64) {
      bytes = Buffer.from(payload, "base64");
    } else {
      let decoded = payload;
      try {
        decoded = decodeURIComponent(payload);
      } catch {
        decoded = payload;
      }
      bytes = Buffer.from(decoded, "utf-8");
    }
    if (bytes.length === 0) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}
