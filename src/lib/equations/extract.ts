export type EquationKind = "display" | "inline";

export interface EquationEntry {
  kind: EquationKind;
  latex: string;
  startOffset: number;
  endOffset: number;
}

export interface EquationsResult {
  display: EquationEntry[];
  inline: EquationEntry[];
  count: number;
}

const DISPLAY_RE = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g;
const INLINE_RE = /(?<![\\$])\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$(?![A-Za-z0-9])/g;
const LATEX_HINT_RE = /[\\^_{}]|\b(?:frac|sum|int|sqrt|alpha|beta|gamma|delta|theta|pi|sigma|infty|leq|geq|neq|approx|cdot|times)\b/;

function looksLikeMath(body: string): boolean {
  if (LATEX_HINT_RE.test(body)) return true;
  if (!/[a-zA-Z]/.test(body)) return false;
  if (/\d/.test(body)) return /[=+\-*/]/.test(body);
  return true;
}

export function extractEquations(text: string): EquationsResult {
  const masked: string[] = [];
  for (const match of text.matchAll(/```[\s\S]*?```|`[^`\n]*`/g)) {
    masked.push(" ".repeat((match[0] ?? "").length));
  }
  const flatMasked = masked.length > 0 ? rebuildMasked(text, masked) : text;

  const display: EquationEntry[] = [];
  for (const m of flatMasked.matchAll(DISPLAY_RE)) {
    if (m.index === undefined) continue;
    display.push({
      kind: "display",
      latex: m[1].trim(),
      startOffset: m.index,
      endOffset: m.index + m[0].length,
    });
  }

  const displayRanges = display.map((d) => [d.startOffset, d.endOffset] as const);
  const inline: EquationEntry[] = [];
  for (const m of flatMasked.matchAll(INLINE_RE)) {
    if (m.index === undefined) continue;
    if (displayRanges.some(([s, e]) => m.index! >= s && m.index! < e)) continue;
    if (!looksLikeMath(m[1])) continue;
    inline.push({
      kind: "inline",
      latex: m[1].trim(),
      startOffset: m.index,
      endOffset: m.index + m[0].length,
    });
  }

  return { display, inline, count: display.length + inline.length };
}

function rebuildMasked(text: string, masks: string[]): string {
  let out = "";
  let cursor = 0;
  let mi = 0;
  for (const match of text.matchAll(/```[\s\S]*?```|`[^`\n]*`/g)) {
    out += text.slice(cursor, match.index);
    out += masks[mi] ?? " ".repeat((match[0] ?? "").length);
    mi += 1;
    cursor = (match.index ?? 0) + (match[0]?.length ?? 0);
  }
  out += text.slice(cursor);
  return out;
}
