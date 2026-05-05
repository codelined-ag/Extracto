import type { Root, RootContent } from "mdast";

import { nodeToPlainText, parseMarkdown } from "@/lib/export/markdown-ast";

const HEADING_SIZES: Record<number, number> = { 1: 36, 2: 32, 3: 28, 4: 26, 5: 24, 6: 22 };

export function markdownToRtf(markdown: string): string {
  const ast = parseMarkdown(markdown);
  const out: string[] = [];
  out.push("{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033");
  out.push("{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}}");
  out.push("\\viewkind4\\uc1\\fs22");
  for (const node of ast.children) {
    out.push(renderBlock(node));
  }
  out.push("}");
  return out.filter(Boolean).join("\n");
}

function renderBlock(node: RootContent): string {
  switch (node.type) {
    case "heading": {
      const size = HEADING_SIZES[node.depth] ?? 22;
      const text = escapeRtf(nodeToPlainText(node));
      return `\\pard\\sb240\\sa120\\b\\fs${size} ${text}\\b0\\par`;
    }
    case "paragraph": {
      const text = renderInline(node.children);
      return `\\pard\\sa180 ${text}\\par`;
    }
    case "list": {
      const lines = node.children.map((item, idx) => {
        const inner = nodeToPlainText(item).trim();
        const bullet = node.ordered ? `${(node.start ?? 1) + idx}.` : "\\bullet";
        return `\\pard\\fi-360\\li360 ${bullet}\\tab ${escapeRtf(inner)}\\par`;
      });
      return lines.join("\n");
    }
    case "table": {
      return renderTable(node.children.map((row) => row.children.map((c) => nodeToPlainText(c))));
    }
    case "code": {
      const text = escapeRtf(node.value ?? "");
      return `\\pard\\f0\\fs20 ${text}\\par`;
    }
    case "blockquote": {
      const text = escapeRtf(nodeToPlainText(node));
      return `\\pard\\li360\\i ${text}\\i0\\par`;
    }
    case "thematicBreak":
      return "\\pard\\par";
    default:
      return "";
  }
}

function renderInline(children: unknown[]): string {
  return children
    .map((child) => {
      const c = child as { type: string; value?: string; children?: unknown[] };
      if (c.type === "text") return escapeRtf(c.value ?? "");
      if (c.type === "strong") return `\\b ${renderInline(c.children ?? [])}\\b0`;
      if (c.type === "emphasis") return `\\i ${renderInline(c.children ?? [])}\\i0`;
      if (c.type === "inlineCode") return `\\f0 ${escapeRtf(c.value ?? "")}\\f0`;
      if (c.type === "link") return renderInline(c.children ?? []);
      if (c.type === "break") return "\\line ";
      return escapeRtf(nodeToPlainText(c));
    })
    .join("");
}

function renderTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidth = Math.floor(9000 / Math.max(1, colCount));
  const out: string[] = [];
  for (const row of rows) {
    const cellDefs = Array.from({ length: colCount }, (_, i) => `\\cellx${(i + 1) * colWidth}`).join("");
    const cells = Array.from({ length: colCount }, (_, i) => `${escapeRtf(row[i] ?? "")}\\cell`).join(" ");
    out.push(`\\trowd\\trgaph108${cellDefs} ${cells}\\row`);
  }
  return out.join("\n") + "\\pard\\par";
}

function escapeRtf(text: string): string {
  const pre = text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
  let out = "";
  for (let i = 0; i < pre.length; i += 1) {
    const code = pre.charCodeAt(i);
    if (code < 128) {
      const ch = pre[i];
      out += ch === "\n" || ch === "\r" ? "\\line " : ch;
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < pre.length) {
      const next = pre.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += `\\u${signedShort(code)}?\\u${signedShort(next)}?`;
        i += 1;
        continue;
      }
    }
    out += `\\u${signedShort(code)}?`;
  }
  return out;
}

function signedShort(code: number): number {
  return code > 32767 ? code - 65536 : code;
}

export type { Root };
