export interface DocumentMetadata {
  title?: string;
  date?: string;
  authors?: string[];
  keywords?: string[];
}

const TITLE_MAX_LEN = 200;
const KEYWORD_MIN_LEN = 4;
const KEYWORD_TOP_N = 5;

const ENGLISH_STOPWORDS = new Set([
  "about","across","after","along","also","although","among","another","any","are","because","been","before","being","between","but","can","could","does","doing","done","during","each","else","every","for","from","has","have","however","into","its","just","like","made","make","makes","many","more","most","much","not","off","one","only","onto","other","over","said","says","saying","should","some","still","such","than","that","their","them","then","there","therefore","they","this","though","three","thus","two","under","upon","very","was","were","what","when","whether","which","while","whilst","who","whom","whose","will","with","within","without","would","yet","you","your",
]);

const looksLikeTitle = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length > TITLE_MAX_LEN) return false;
  if (/^\d+$/.test(trimmed)) return false;
  if (/^page\s+\d+/i.test(trimmed)) return false;
  return true;
};

const stripMarkdownChars = (line: string): string =>
  line.replace(/^#+\s*/, "").replace(/^\*+\s*/, "").replace(/\s+#+\s*$/, "").trim();

const extractTitle = (firstPage: string): string | undefined => {
  const lines = firstPage.split(/\r?\n/);
  for (const line of lines) {
    const candidate = stripMarkdownChars(line);
    if (looksLikeTitle(candidate)) return candidate;
  }
  return undefined;
};

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/;
const SLASH_DATE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
const LONG_DATE =
  /\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{2,4})\b/i;
const MONTH_FIRST_DATE =
  /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{2,4})\b/i;

const extractDate = (firstPage: string): string | undefined => {
  const head = firstPage.slice(0, 1500);
  const match =
    head.match(ISO_DATE) ??
    head.match(LONG_DATE) ??
    head.match(MONTH_FIRST_DATE) ??
    head.match(SLASH_DATE);
  return match?.[1];
};

const AUTHOR_LINE = /^\s*(?:authors?|by|escrito por|scritto da|écrit par|verfasser)\s*[:\-]\s*(.+)$/im;

const extractAuthors = (firstPage: string): string[] | undefined => {
  const match = firstPage.match(AUTHOR_LINE);
  if (!match) return undefined;
  const raw = match[1].trim();
  if (!raw) return undefined;
  const split = raw
    .split(/(?:,|;|\sand\s|\s&\s)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 80);
  if (split.length === 0) return undefined;
  return Array.from(new Set(split));
};

const tokenize = (text: string): string[] =>
  (text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .match(/[a-z][a-z'-]+/g) ?? []);

const extractKeywords = (firstPage: string, language?: string): string[] | undefined => {
  if (language && language !== "eng" && language !== "und") return undefined;
  const tokens = tokenize(firstPage);
  if (tokens.length < 30) return undefined;
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (token.length < KEYWORD_MIN_LEN) continue;
    if (ENGLISH_STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, KEYWORD_TOP_N)
    .map(([word]) => word);
  return ranked.length > 0 ? ranked : undefined;
};

export function extractDocumentMetadata(
  firstPageText: string,
  language?: string,
): DocumentMetadata {
  if (!firstPageText) return {};
  const meta: DocumentMetadata = {};
  const title = extractTitle(firstPageText);
  if (title) meta.title = title;
  const date = extractDate(firstPageText);
  if (date) meta.date = date;
  const authors = extractAuthors(firstPageText);
  if (authors) meta.authors = authors;
  const keywords = extractKeywords(firstPageText, language);
  if (keywords) meta.keywords = keywords;
  return meta;
}
