import type { DocumentPresetKind } from "@/lib/ocr/settings";

export interface DocumentPreset {
  id: DocumentPresetKind;
  label: string;
  promptAddendum: string;
  jsonSchemaHint?: string;
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
      "This document is a scholarly paper. Honor the standard structure: Title, Authors, Abstract, Introduction, sections (#, ##), Figures with captions, Tables (rendered as Markdown tables), References.",
      "Detect multi-column layouts and merge them into one continuous reading flow per section.",
      "Inline mathematical expressions in $...$ and display equations in $$...$$.",
      "Cite-references like [12] or (Smith et al., 2024) MUST be preserved verbatim.",
      "Move footnotes and page-numbers OUT of the main flow (drop them or move to the end as a notes block).",
    ].join("\n"),
  },
  invoice: {
    id: "invoice",
    label: "Invoice / receipt",
    promptAddendum: [
      "This is an invoice or receipt. Output a single JSON object with keys: vendor, invoiceNumber, issueDate, dueDate, currency, lineItems (array of {description, quantity, unitPrice, total}), subtotal, tax, total, paymentTerms, notes.",
      "Use ISO 8601 dates (YYYY-MM-DD). Use string ISO 4217 codes for currency. Use numeric (not string) values for quantities and amounts.",
      "If a field is not present in the document, omit the key (do not write null or empty string).",
    ].join("\n"),
    jsonSchemaHint: "invoice",
  },
  contract: {
    id: "contract",
    label: "Contract",
    promptAddendum: [
      "This is a legal contract. Preserve the exact wording. Render numbered clauses (1., 1.1, 1.1.1) as nested markdown lists, capitals as written.",
      "Highlight defined terms (Capitalized Terms in Quotes) verbatim. Do not paraphrase, do not summarize, do not omit.",
      "Output Schedules / Exhibits / Annexes as separate ## headings.",
      "Signature blocks and dates at the end as a structured Signatures section.",
    ].join("\n"),
  },
  form: {
    id: "form",
    label: "Form",
    promptAddendum: [
      "This is a form (questionnaire, intake, application). Output a single JSON object whose keys are the field labels (snake_case) and values are the user-entered values.",
      "If a field is empty, omit the key. For checkbox groups, the value is an array of the checked options.",
      "If the form has multiple sections, nest them under per-section keys.",
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
