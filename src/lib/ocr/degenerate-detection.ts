export interface DegenerateSignal {
  reason: "char-run" | "no-whitespace" | "token-loop" | "provider-noise";
}

const MIN_CHARS_TO_INSPECT = 80;
const CHAR_RUN_THRESHOLD = 25;
const NO_WHITESPACE_THRESHOLD = 200;
const TOKEN_LOOP_MIN_REPEATS = 6;
const TOKEN_LOOP_WINDOW_TOKENS = 3;
const TOKEN_LOOP_MIN_PAGE_FRACTION = 0.4;

const PROVIDER_NOISE = [
  /<\|.*?\|>/g,
  /<\/?s>/g,
  /\[\s*INST\s*\]/gi,
  /\[\s*\/INST\s*\]/gi,
  /assistant:\s*$/i,
];

const hasCharRun = (text: string): boolean => {
  let runChar = "";
  let runLen = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      runChar = "";
      runLen = 0;
      continue;
    }
    if (ch === runChar) {
      runLen += 1;
      if (runLen >= CHAR_RUN_THRESHOLD) return true;
    } else {
      runChar = ch;
      runLen = 1;
    }
  }
  return false;
};

const hasNoWhitespaceBlock = (text: string): boolean => {
  const tokens = text.split(/\s+/);
  for (const token of tokens) {
    if (token.length >= NO_WHITESPACE_THRESHOLD) return true;
  }
  return false;
};

const hasTokenLoop = (text: string): boolean => {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < TOKEN_LOOP_MIN_REPEATS * 2) return false;
  for (let window = 1; window <= TOKEN_LOOP_WINDOW_TOKENS; window += 1) {
    let consecutive = 1;
    let bestConsecutive = 1;
    for (let i = window; i + window <= words.length; i += window) {
      const a = words.slice(i - window, i).join(" ");
      const b = words.slice(i, i + window).join(" ");
      if (a === b) {
        consecutive += 1;
        if (consecutive > bestConsecutive) bestConsecutive = consecutive;
      } else {
        consecutive = 1;
      }
    }
    if (bestConsecutive < TOKEN_LOOP_MIN_REPEATS) continue;
    const tokensConsumed = bestConsecutive * window;
    if (tokensConsumed / words.length >= TOKEN_LOOP_MIN_PAGE_FRACTION) return true;
  }
  return false;
};

const hasProviderNoise = (text: string): boolean => {
  for (const re of PROVIDER_NOISE) {
    if (re.test(text)) return true;
  }
  return false;
};

export function detectDegenerate(text: string): DegenerateSignal | null {
  if (!text || text.length < MIN_CHARS_TO_INSPECT) return null;
  if (hasProviderNoise(text)) return { reason: "provider-noise" };
  if (hasCharRun(text)) return { reason: "char-run" };
  if (hasNoWhitespaceBlock(text)) return { reason: "no-whitespace" };
  if (hasTokenLoop(text)) return { reason: "token-loop" };
  return null;
}
