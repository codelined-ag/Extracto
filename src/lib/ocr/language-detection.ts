import { francAll } from "franc-min";
import { iso6393 } from "iso-639-3";

export interface DetectedLanguage {
  iso6393: string;
  name: string | null;
}

const MIN_DETECTION_CHARS = 24;
const MIN_TOP_SCORE = 0.9;
const MIN_LEAD = 0.05;

const ISO_CODE_TO_NAME = new Map<string, string>(
  iso6393.map((entry) => [entry.iso6393, entry.name]),
);

const lookupName = (code: string): string | null => {
  if (!code || code === "und") return null;
  return ISO_CODE_TO_NAME.get(code) ?? null;
};

const stripNonProseTokens = (input: string): string =>
  input
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[\w./-]+\.[a-z]{2,}\/?\S*/gi, " ")
    .replace(/\b[\d.,:%/\\$£€¥+\-_=()*[\]{}<>'"`~|^&!?]+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function detectPageLanguage(text: string): DetectedLanguage | null {
  if (!text) return null;
  const cleaned = stripNonProseTokens(text);
  if (cleaned.length < MIN_DETECTION_CHARS) return null;
  const scores = francAll(cleaned, { minLength: MIN_DETECTION_CHARS });
  if (!Array.isArray(scores) || scores.length === 0) return null;
  const [top, second] = scores;
  if (!top || top[0] === "und") return null;
  if (top[1] < MIN_TOP_SCORE) return null;
  const lead = top[1] - (second?.[1] ?? 0);
  if (lead < MIN_LEAD) return null;
  return { iso6393: top[0], name: lookupName(top[0]) };
}
