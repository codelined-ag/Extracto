export type PiiKind =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "iban"
  | "ip"
  | "url"
  | "date_of_birth";

export interface PiiMatch {
  kind: PiiKind;
  startOffset: number;
  endOffset: number;
}

export interface RedactionResult {
  redactedText: string;
  matches: PiiMatch[];
  countsByKind: Record<PiiKind, number>;
}

interface PatternEntry {
  kind: PiiKind;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

const PATTERNS: PatternEntry[] = [
  {
    kind: "email",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g,
  },
  {
    kind: "ssn",
    regex: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    kind: "credit_card",
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: luhnValid,
  },
  {
    kind: "iban",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
  },
  {
    kind: "ip",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
  },
  {
    kind: "url",
    regex: /\bhttps?:\/\/[^\s<>"]+/g,
  },
  {
    kind: "phone",
    regex: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g,
    validate: (m) => m.replace(/\D/g, "").length >= 7,
  },
  {
    kind: "date_of_birth",
    regex: /\b(?:0[1-9]|1[0-2])[/-](?:0[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/g,
  },
];

export function redactPii(text: string): RedactionResult {
  const matches: PiiMatch[] = [];
  const counts: Record<PiiKind, number> = {
    email: 0,
    phone: 0,
    ssn: 0,
    credit_card: 0,
    iban: 0,
    ip: 0,
    url: 0,
    date_of_birth: 0,
  };
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      if (pattern.validate && !pattern.validate(match[0])) continue;
      matches.push({
        kind: pattern.kind,
        startOffset: match.index,
        endOffset: match.index + match[0].length,
      });
    }
  }
  matches.sort(matchOrder);
  const merged = mergeOverlapping(matches);
  let redactedText = "";
  let cursor = 0;
  for (const m of merged) {
    redactedText += text.slice(cursor, m.startOffset);
    counts[m.kind] += 1;
    redactedText += `[REDACTED:${m.kind.toUpperCase()}:${counts[m.kind]}]`;
    cursor = m.endOffset;
  }
  redactedText += text.slice(cursor);
  return { redactedText, matches: merged, countsByKind: counts };
}

function matchOrder(a: PiiMatch, b: PiiMatch): number {
  if (a.startOffset !== b.startOffset) return a.startOffset - b.startOffset;
  return b.endOffset - a.endOffset;
}

function mergeOverlapping(matches: PiiMatch[]): PiiMatch[] {
  const out: PiiMatch[] = [];
  for (const m of matches) {
    const last = out[out.length - 1];
    if (last && m.startOffset < last.endOffset) {
      if (m.endOffset > last.endOffset) last.endOffset = m.endOffset;
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

export function redactJsonValues(value: unknown): unknown {
  if (typeof value === "string") return redactPii(value).redactedText;
  if (Array.isArray(value)) return value.map(redactJsonValues);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactJsonValues(v);
    }
    return out;
  }
  return value;
}

function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
