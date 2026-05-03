import type { DocumentPresetKind } from "@/lib/ocr/settings";

export interface DocumentPreset {
  id: DocumentPresetKind;
  label: string;
  promptAddendum: string;
  jsonSchemaHint?: string;
  forceTableDetection?: boolean;
  forcePreserveFormatting?: boolean;
}

export const DOCUMENT_PRESETS: Record<DocumentPresetKind, DocumentPreset> = {
  generic: {
    id: "generic",
    label: "Generic",
    promptAddendum: "",
  },
  academic: {
    id: "academic",
    label: "Academic paper",
    promptAddendum: [
      "This document is a scholarly paper.",
      "Emit each section as `## Section name` followed by its body in markdown.",
      "Render each table as a markdown table; do NOT collapse multi-row tables into prose.",
      "Detect multi-column layouts and merge them into one continuous reading flow per section.",
      "Inline mathematical expressions with `$..$` and display equations with `$$..$$`.",
      "Preserve cite-references like [12] or (Smith et al., 2024) byte-for-byte; do NOT renumber, summarize, or hyperlink them.",
      "Move footnotes and page numbers OUT of the main flow into a final `## Notes` block (or drop if duplicated).",
    ].join("\n"),
    forceTableDetection: true,
    forcePreserveFormatting: true,
  },
  invoice: {
    id: "invoice",
    label: "Invoice / receipt",
    promptAddendum: [
      "This document is an invoice or receipt.",
      "Place the structured invoice data inside the `fields.invoice` object of the response (NOT at the top level).",
      "Required keys when present: vendor, invoiceNumber, issueDate (YYYY-MM-DD), dueDate (YYYY-MM-DD), currency (ISO 4217), lineItems (array of {description, quantity, unitPrice, total}), subtotal, tax, total, paymentTerms, notes.",
      "Use numeric (not string) values for quantities and amounts. Omit any key that is not present in the document.",
      "The `markdown` field of the response should be a short human-readable summary (vendor, total, date) so users can scan results without parsing JSON.",
    ].join("\n"),
    jsonSchemaHint: "invoice",
    forceTableDetection: true,
  },
  contract: {
    id: "contract",
    label: "Contract",
    promptAddendum: [
      "This document is a legal contract. Preserve the exact wording byte-for-byte.",
      "Render numbered clauses literally: `1.`, `1.1`, `1.1.1`, `1.1.1.1`. Keep the original numbering as text; do NOT replace it with markdown bullets or auto-numbers.",
      "Highlight defined terms (Capitalized Words inside Quotes) verbatim. Do not paraphrase, do not summarize, do not skip clauses.",
      "Render Schedules / Exhibits / Annexes as separate `## Schedule X` headings.",
      "End with a `## Signatures` section listing each signatory line and date.",
    ].join("\n"),
    forcePreserveFormatting: true,
  },
  form: {
    id: "form",
    label: "Form",
    promptAddendum: [
      "This document is a form (questionnaire, intake, application).",
      "Place the extracted form data inside the `fields.form` object of the response (NOT at the top level).",
      "Each top-level key is a snake_case version of the field label; the value is the user-entered value or, for checkbox groups, an array of checked options.",
      "If a field is empty, omit the key entirely. If the form has multiple sections, nest them under per-section keys.",
      "The `markdown` field of the response should be the form rendered as a `Label: value` list for human review.",
    ].join("\n"),
    jsonSchemaHint: "form",
  },
};

export function getDocumentPreset(kind: DocumentPresetKind): DocumentPreset {
  return DOCUMENT_PRESETS[kind] ?? DOCUMENT_PRESETS.generic;
}

export function applyDocumentPresetToPrompt(basePrompt: string, kind: DocumentPresetKind): string {
  const preset = getDocumentPreset(kind);
  if (!preset.promptAddendum.trim()) return basePrompt;
  return [`DOCUMENT TYPE: ${preset.label}`, "", preset.promptAddendum, "", basePrompt.trim()].join("\n");
}
