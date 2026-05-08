export type PiiKind =
  | "email"
  | "phone"
  | "ssn"
  | "credit_card"
  | "iban"
  | "ip"
  | "url"
  | "date_of_birth"
  | "address"
  | "person_name"
  | "passport"
  | "drivers_license";

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
    regex: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?\d{3,4}[\s.-]?\d{3,4}|\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4})/g,
    validate: isLikelyPhone,
  },
  {
    kind: "date_of_birth",
    regex: /\b(?:(?:0[1-9]|1[0-2])[/-](?:0[1-9]|[12]\d|3[01])[/-](?:19\d{2}|20[01]\d)|(?:0[1-9]|[12]\d|3[01])[/-](?:0[1-9]|1[0-2])[/-](?:19\d{2}|20[01]\d)|(?:0[1-9]|[12]\d|3[01])\.(?:0[1-9]|1[0-2])\.(?:19\d{2}|20[01]\d)|(?:19\d{2}|20[01]\d)-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g,
  },
  {
    kind: "address",
    regex: /\b\d{1,5}\s+(?:[A-Z][a-zA-Z]*\s+){1,4}(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Plaza|Plz|Square|Sq|Way|Parkway|Pkwy|Highway|Hwy|Place|Pl|Terrace|Ter)\b\.?/g,
  },
  {
    kind: "person_name",
    regex: /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Professor|Sir|Madam|Mx)\.?\s+[A-Z][a-z]{1,20}(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]{1,20}){1,3}\b/g,
  },
  {
    kind: "passport",
    regex: /\b(?:passport|pass(?:port)?\s*(?:no|number|#))[\s:.]*([A-Z0-9]{6,9})\b/gi,
  },
  {
    kind: "drivers_license",
    regex: /\b(?:driver(?:'s)?\s+licen[cs]e|driving\s+licen[cs]e|DL)\s*(?:no|number|#)?[\s:.]*([A-Z0-9]{5,15})\b/gi,
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
    address: 0,
    person_name: 0,
    passport: 0,
    drivers_license: 0,
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

const COUNTRY_CODES = new Set([
  "1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44",
  "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61",
  "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95",
  "98", "212", "213", "216", "218", "220", "221", "222", "223", "224", "225", "226", "227",
  "228", "229", "230", "231", "232", "233", "234", "235", "236", "237", "238", "239", "240",
  "241", "242", "243", "244", "245", "248", "249", "250", "251", "252", "253", "254", "255",
  "256", "257", "258", "260", "261", "262", "263", "264", "265", "266", "267", "268", "269",
  "297", "298", "299", "350", "351", "352", "353", "354", "355", "356", "357", "358", "359",
  "370", "371", "372", "373", "374", "375", "376", "377", "378", "380", "381", "382", "385",
  "386", "387", "389", "420", "421", "423", "500", "501", "502", "503", "504", "505", "506",
  "507", "508", "509", "590", "591", "592", "593", "594", "595", "596", "597", "598", "670",
  "672", "673", "674", "675", "676", "677", "678", "679", "680", "681", "682", "683", "685",
  "686", "687", "688", "689", "690", "691", "692", "850", "852", "853", "855", "856", "880",
  "886", "960", "961", "962", "963", "964", "965", "966", "967", "968", "970", "971", "972",
  "973", "974", "975", "976", "977", "992", "993", "994", "995", "996", "998",
]);

function isLikelyPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  if (/^0+$/.test(digits)) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  if (value.trim().startsWith("+")) {
    if (
      !COUNTRY_CODES.has(digits.slice(0, 1)) &&
      !COUNTRY_CODES.has(digits.slice(0, 2)) &&
      !COUNTRY_CODES.has(digits.slice(0, 3))
    ) {
      return false;
    }
  } else if (digits.length === 11 && digits.startsWith("1")) {
    return true;
  } else if (digits.length === 10) {
    return true;
  } else if (digits.length > 11) {
    return false;
  }
  return true;
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
