export type DiffOp = "equal" | "insert" | "delete";

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function diffWords(a: string, b: string): DiffSegment[] {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const lcs = lcsTable(ta, tb);
  const segments: DiffSegment[] = [];
  let i = ta.length;
  let j = tb.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ta[i - 1] === tb[j - 1]) {
      segments.push({ op: "equal", text: ta[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      segments.push({ op: "insert", text: tb[j - 1] });
      j -= 1;
    } else if (i > 0) {
      segments.push({ op: "delete", text: ta[i - 1] });
      i -= 1;
    }
  }
  segments.reverse();
  return mergeRuns(segments);
}

function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table;
}

function mergeRuns(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.op === seg.op) {
      last.text += seg.text;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

export interface DiffSummary {
  equalChars: number;
  insertedChars: number;
  deletedChars: number;
  similarity: number;
}

export function summarizeDiff(segments: DiffSegment[]): DiffSummary {
  let equalChars = 0;
  let insertedChars = 0;
  let deletedChars = 0;
  for (const seg of segments) {
    if (seg.op === "equal") equalChars += seg.text.length;
    else if (seg.op === "insert") insertedChars += seg.text.length;
    else deletedChars += seg.text.length;
  }
  const denominator = equalChars + insertedChars + deletedChars;
  const similarity = denominator === 0 ? 1 : equalChars / denominator;
  return { equalChars, insertedChars, deletedChars, similarity: Math.round(similarity * 1000) / 1000 };
}
