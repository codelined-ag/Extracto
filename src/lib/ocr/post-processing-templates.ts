export const POST_PROCESS_TEMPLATES = [
  "custom",
  "translate",
  "summarize-3sentence",
  "summarize-executive",
  "extract-actions",
] as const;

export type PostProcessTemplate = (typeof POST_PROCESS_TEMPLATES)[number];

export const DEFAULT_POST_PROCESS_TEMPLATE: PostProcessTemplate = "custom";

export function isPostProcessTemplate(value: unknown): value is PostProcessTemplate {
  return typeof value === "string" && (POST_PROCESS_TEMPLATES as readonly string[]).includes(value);
}

export interface ResolveTemplateInput {
  template: PostProcessTemplate;
  targetLanguage?: string;
  customInstruction?: string;
}

export function resolveTemplateInstruction(input: ResolveTemplateInput): string {
  switch (input.template) {
    case "translate": {
      const lang = (input.targetLanguage ?? "").trim();
      if (!lang) return "";
      return [
        `Translate the OCR'd document into ${lang}.`,
        "Preserve every heading, list, table, and code block in the same place.",
        "Do not add commentary or summarize. Output the translation only.",
      ].join(" ");
    }
    case "summarize-3sentence":
      return "Summarize the OCR'd document in three sentences. Capture the main point, the supporting evidence, and any next steps the document calls for. Output the summary only.";
    case "summarize-executive":
      return [
        "Write an executive summary of the OCR'd document.",
        "Open with one sentence stating the headline, then a short paragraph (3 to 6 sentences) covering scope, decisions or findings, and any open questions.",
        "Use plain prose, no bullets, no markdown headings, no commentary.",
      ].join(" ");
    case "extract-actions":
      return [
        "Extract all action items from the OCR'd document.",
        "Output as a markdown list. Each item starts with the verb, names the owner if mentioned, and includes the deadline if mentioned.",
        "If the document has no action items, output the single line: No action items found.",
      ].join(" ");
    case "custom":
    default:
      return (input.customInstruction ?? "").trim();
  }
}

const ACCEPTED_LANGUAGE_RE = /^[a-zA-Z][a-zA-Z0-9 _.,()-]*$/;
const MAX_TARGET_LANGUAGE_LENGTH = 80;

export function sanitizeTargetLanguage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().slice(0, MAX_TARGET_LANGUAGE_LENGTH);
  if (!trimmed) return "";
  if (!ACCEPTED_LANGUAGE_RE.test(trimmed)) return "";
  return trimmed;
}
