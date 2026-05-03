// Pure utilities lifted out of src/app/page.tsx (which still owns the
// huge ExtractoPage component). These are formatters + JSON-parsing
// helpers with no React state, so they're easier to read in isolation
// and become unit-testable.

import {
  extractFirstBalancedJsonObject,
  extractMarkdownFromJsonLikeText,
} from "@/lib/ocr/text-extract";

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export const formatTimestamp = (value?: string | null): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const formatEta = (value?: number | null): string => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-";
  }
  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export function parseLooseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const directCandidates = [
    trimmed,
    trimmed.replace(/^json\s*/iu, "").trim(),
    trimmed.replace(/^['"]+|['"]+$/g, "").trim(),
  ];

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fencedMatch?.[1]) {
    directCandidates.unshift(fencedMatch[1].trim());
  }

  for (const candidate of directCandidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue
    }
  }

  const balanced = extractFirstBalancedJsonObject(trimmed);
  if (balanced) {
    try {
      const parsed = JSON.parse(balanced);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function normalizeMarkdownCandidate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const parsed = parseLooseJsonObject(trimmed);
  if (parsed) {
    const nested = parsed.markdown ?? parsed.text ?? parsed.content;
    if (typeof nested === "string" && nested.trim()) {
      return nested.trim();
    }
  }

  const extracted = extractMarkdownFromJsonLikeText(trimmed);
  if (extracted) {
    return extracted;
  }

  return trimmed;
}

export function getMarkdownFromJsonPayload(payload: unknown, fallback = ""): string {
  const fallbackNormalized = normalizeMarkdownCandidate(fallback);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallbackNormalized;
  }

  const typed = payload as Record<string, unknown>;
  if (typeof typed.markdown === "string" && typed.markdown.trim()) {
    return normalizeMarkdownCandidate(typed.markdown);
  }

  if (
    typed.structured &&
    typeof typed.structured === "object" &&
    !Array.isArray(typed.structured) &&
    typeof (typed.structured as Record<string, unknown>).markdown === "string" &&
    ((typed.structured as Record<string, unknown>).markdown as string).trim()
  ) {
    return normalizeMarkdownCandidate((typed.structured as Record<string, unknown>).markdown as string);
  }

  if (typeof typed.text === "string" && typed.text.trim()) {
    return normalizeMarkdownCandidate(typed.text);
  }

  return fallbackNormalized;
}

export function getStructuredJsonPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const typed = payload as Record<string, unknown>;
  if (typed.structured && typeof typed.structured === "object" && !Array.isArray(typed.structured)) {
    return typed.structured as Record<string, unknown>;
  }

  return typed;
}

import type { UiLanguage } from "@/app/page-components/types";

export type PipelineLanguage = UiLanguage;

type PipelineDict = Record<PipelineLanguage, string>;

const PIPELINE_DICT_PATTERNS: Array<{ regex: RegExp; build: (m: RegExpMatchArray) => PipelineDict }> = [
  {
    regex: /^Running OCR on page (\d+)\/(\d+)$/i,
    build: (m) => ({
      it: `OCR in corso sulla pagina ${m[1]}/${m[2]}`,
      en: `Running OCR on page ${m[1]}/${m[2]}`,
      fr: `OCR en cours sur la page ${m[1]}/${m[2]}`,
      es: `OCR en curso en la página ${m[1]}/${m[2]}`,
      de: `OCR läuft auf Seite ${m[1]}/${m[2]}`,
    }),
  },
  {
    regex: /^Completed page (\d+)\/(\d+) in ([\d.]+)s$/i,
    build: (m) => ({
      it: `Pagina ${m[1]}/${m[2]} completata in ${m[3]}s`,
      en: `Completed page ${m[1]}/${m[2]} in ${m[3]}s`,
      fr: `Page ${m[1]}/${m[2]} terminée en ${m[3]}s`,
      es: `Página ${m[1]}/${m[2]} completada en ${m[3]}s`,
      de: `Seite ${m[1]}/${m[2]} in ${m[3]}s abgeschlossen`,
    }),
  },
  {
    regex: /^Completed page (\d+)\/(\d+)$/i,
    build: (m) => ({
      it: `Pagina ${m[1]}/${m[2]} completata`,
      en: `Completed page ${m[1]}/${m[2]}`,
      fr: `Page ${m[1]}/${m[2]} terminée`,
      es: `Página ${m[1]}/${m[2]} completada`,
      de: `Seite ${m[1]}/${m[2]} abgeschlossen`,
    }),
  },
  {
    regex: /^Document analyzed: (\d+) page\(s\) ready$/i,
    build: (m) => ({
      it: `Documento analizzato: ${m[1]} pagina/e pronte`,
      en: `Document analyzed: ${m[1]} page(s) ready`,
      fr: `Document analysé : ${m[1]} page(s) prête(s)`,
      es: `Documento analizado: ${m[1]} página(s) lista(s)`,
      de: `Dokument analysiert: ${m[1]} Seite(n) bereit`,
    }),
  },
  {
    regex: /^Resuming from page (\d+)\/(\d+)$/i,
    build: (m) => ({
      it: `Ripresa dalla pagina ${m[1]}/${m[2]}`,
      en: `Resuming from page ${m[1]}/${m[2]}`,
      fr: `Reprise depuis la page ${m[1]}/${m[2]}`,
      es: `Reanudando desde la página ${m[1]}/${m[2]}`,
      de: `Fortsetzung ab Seite ${m[1]}/${m[2]}`,
    }),
  },
  {
    regex: /^Resuming OCR from checkpoint \((\d+)\/(\d+) pages complete\)$/i,
    build: (m) => ({
      it: `Ripresa OCR dal checkpoint (${m[1]}/${m[2]} pagine completate)`,
      en: `Resuming OCR from checkpoint (${m[1]}/${m[2]} pages complete)`,
      fr: `Reprise OCR depuis le checkpoint (${m[1]}/${m[2]} pages terminées)`,
      es: `Reanudando OCR desde checkpoint (${m[1]}/${m[2]} páginas completadas)`,
      de: `OCR vom Checkpoint fortgesetzt (${m[1]}/${m[2]} Seiten abgeschlossen)`,
    }),
  },
  {
    regex: /^Prepared (\d+) page\(s\) for OCR$/i,
    build: (m) => ({
      it: `Preparate ${m[1]} pagina/e per l'OCR`,
      en: `Prepared ${m[1]} page(s) for OCR`,
      fr: `${m[1]} page(s) préparée(s) pour l'OCR`,
      es: `${m[1]} página(s) preparada(s) para OCR`,
      de: `${m[1]} Seite(n) für OCR vorbereitet`,
    }),
  },
  {
    regex: /^Stopped at (\d+)\/(\d+) page\(s\)$/i,
    build: (m) => ({
      it: `Fermato a ${m[1]}/${m[2]} pagina/e`,
      en: `Stopped at ${m[1]}/${m[2]} page(s)`,
      fr: `Arrêté à ${m[1]}/${m[2]} page(s)`,
      es: `Detenido en ${m[1]}/${m[2]} página(s)`,
      de: `Bei ${m[1]}/${m[2]} Seite(n) gestoppt`,
    }),
  },
  {
    regex: /^Resume requested from page (\d+)\/(\d+)$/i,
    build: (m) => ({
      it: `Ripresa richiesta dalla pagina ${m[1]}/${m[2]}`,
      en: `Resume requested from page ${m[1]}/${m[2]}`,
      fr: `Reprise demandée depuis la page ${m[1]}/${m[2]}`,
      es: `Reanudación solicitada desde la página ${m[1]}/${m[2]}`,
      de: `Fortsetzung ab Seite ${m[1]}/${m[2]} angefordert`,
    }),
  },
  {
    regex: /^OCR will use (.+); selected inference model is (.+)$/i,
    build: (m) => ({
      it: `OCR userà ${m[1]}; modello di inferenza selezionato: ${m[2]}`,
      en: `OCR will use ${m[1]}; selected inference model is ${m[2]}`,
      fr: `OCR utilisera ${m[1]} ; modèle d'inférence sélectionné : ${m[2]}`,
      es: `OCR usará ${m[1]}; modelo de inferencia seleccionado: ${m[2]}`,
      de: `OCR verwendet ${m[1]}; gewähltes Inferenzmodell: ${m[2]}`,
    }),
  },
  {
    regex: /^Using (.+) for OCR and (.+) for inference$/i,
    build: (m) => ({
      it: `${m[1]} per l'OCR e ${m[2]} per l'inferenza`,
      en: `Using ${m[1]} for OCR and ${m[2]} for inference`,
      fr: `${m[1]} pour l'OCR et ${m[2]} pour l'inférence`,
      es: `${m[1]} para OCR y ${m[2]} para inferencia`,
      de: `${m[1]} für OCR und ${m[2]} für Inferenz`,
    }),
  },
  {
    regex: /^Running post-processing with (.+)$/i,
    build: (m) => ({
      it: `Post-processing in corso con ${m[1]}`,
      en: `Running post-processing with ${m[1]}`,
      fr: `Post-traitement en cours avec ${m[1]}`,
      es: `Post-procesamiento en curso con ${m[1]}`,
      de: `Nachverarbeitung mit ${m[1]} läuft`,
    }),
  },
  {
    regex: /^Applying post-processing with (.+)$/i,
    build: (m) => ({
      it: `Applicazione post-processing con ${m[1]}`,
      en: `Applying post-processing with ${m[1]}`,
      fr: `Application du post-traitement avec ${m[1]}`,
      es: `Aplicando post-procesamiento con ${m[1]}`,
      de: `Nachverarbeitung mit ${m[1]} wird angewendet`,
    }),
  },
];

const PIPELINE_DICT_EXACT: Record<string, PipelineDict> = {
  "OCR job completed": {
    it: "OCR completato",
    en: "OCR job completed",
    fr: "OCR terminé",
    es: "OCR completado",
    de: "OCR abgeschlossen",
  },
  "Completed": {
    it: "Completato",
    en: "Completed",
    fr: "Terminé",
    es: "Completado",
    de: "Abgeschlossen",
  },
  "Job created": {
    it: "Job creato",
    en: "Job created",
    fr: "Tâche créée",
    es: "Trabajo creado",
    de: "Job erstellt",
  },
  "Queued for OCR": {
    it: "In coda per l'OCR",
    en: "Queued for OCR",
    fr: "En file d'attente pour l'OCR",
    es: "En cola para OCR",
    de: "In OCR-Warteschlange",
  },
  "Resume requested": {
    it: "Ripresa richiesta",
    en: "Resume requested",
    fr: "Reprise demandée",
    es: "Reanudación solicitada",
    de: "Fortsetzung angefordert",
  },
  "Stopped. Resume to continue from checkpoint.": {
    it: "Fermato. Riprendi per continuare dal checkpoint.",
    en: "Stopped. Resume to continue from checkpoint.",
    fr: "Arrêté. Reprenez pour continuer depuis le checkpoint.",
    es: "Detenido. Reanude para continuar desde el checkpoint.",
    de: "Gestoppt. Fortsetzen, um vom Checkpoint weiterzumachen.",
  },
  "OCR processing failed": {
    it: "Elaborazione OCR non riuscita",
    en: "OCR processing failed",
    fr: "Échec du traitement OCR",
    es: "Error en el procesamiento OCR",
    de: "OCR-Verarbeitung fehlgeschlagen",
  },
  "Ready": {
    it: "Pronto",
    en: "Ready",
    fr: "Prêt",
    es: "Listo",
    de: "Bereit",
  },
};

export function translatePipelineMessage(raw: string | undefined | null, lang: PipelineLanguage): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const exact = PIPELINE_DICT_EXACT[trimmed];
  if (exact) return exact[lang] ?? exact.en;
  for (const entry of PIPELINE_DICT_PATTERNS) {
    const m = trimmed.match(entry.regex);
    if (m) {
      const dict = entry.build(m);
      return dict[lang] ?? dict.en;
    }
  }
  return raw;
}
