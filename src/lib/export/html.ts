import type { RootContent } from "mdast";

import { nodeToPlainText, parseMarkdown } from "@/lib/export/markdown-ast";

export function markdownToHtml(markdown: string): string {
  const ast = parseMarkdown(markdown);
  const body = ast.children.map(renderBlock).join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Extracto export</title>',
    '<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1a1a1a}h1,h2,h3,h4,h5,h6{line-height:1.25;margin-top:1.6rem}pre{background:#f5f5f5;padding:.6rem .8rem;overflow-x:auto;border-radius:6px}code{background:#f5f5f5;padding:.1rem .3rem;border-radius:3px}table{border-collapse:collapse;margin:1rem 0;width:100%}td,th{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}th{background:#f5f5f5}blockquote{border-left:3px solid #ccc;margin:1rem 0;padding:.2rem 1rem;color:#555}</style>',
    "</head><body>",
    body,
    "</body></html>",
  ].join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBlock(node: RootContent): string {
  switch (node.type) {
    case "heading":
      return `<h${node.depth}>${renderInline(node.children)}</h${node.depth}>`;
    case "paragraph":
      return `<p>${renderInline(node.children)}</p>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const startAttr = node.ordered && node.start && node.start !== 1 ? ` start="${node.start}"` : "";
      const items = node.children
        .map((item) => {
          const inner = item.children.map(renderBlock).join("");
          return `<li>${stripWrappingP(inner)}</li>`;
        })
        .join("");
      return `<${tag}${startAttr}>${items}</${tag}>`;
    }
    case "table": {
      const rows = node.children.map((row) => row.children.map((cell) => nodeToPlainText(cell)));
      const [header, ...body] = rows;
      const thead = header
        ? `<thead><tr>${header.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`
        : "";
      const cols = Math.max(header?.length ?? 0, ...body.map((r) => r.length));
      const tbody = body
        .map((row) => `<tr>${Array.from({ length: cols }, (_, i) => `<td>${escapeHtml(row[i] ?? "")}</td>`).join("")}</tr>`)
        .join("");
      return `<table>${thead}<tbody>${tbody}</tbody></table>`;
    }
    case "code": {
      const lang = node.lang ? ` class="language-${escapeHtml(node.lang)}"` : "";
      return `<pre><code${lang}>${escapeHtml(node.value ?? "")}</code></pre>`;
    }
    case "blockquote": {
      const inner = node.children.map(renderBlock).join("");
      return `<blockquote>${inner}</blockquote>`;
    }
    case "thematicBreak":
      return "<hr>";
    case "html":
      return "";
    default:
      return "";
  }
}

function renderInline(children: unknown[]): string {
  return children
    .map((child) => {
      const c = child as { type: string; value?: string; children?: unknown[]; url?: string };
      if (c.type === "text") return escapeHtml(c.value ?? "");
      if (c.type === "strong") return `<strong>${renderInline(c.children ?? [])}</strong>`;
      if (c.type === "emphasis") return `<em>${renderInline(c.children ?? [])}</em>`;
      if (c.type === "delete") return `<s>${renderInline(c.children ?? [])}</s>`;
      if (c.type === "inlineCode") return `<code>${escapeHtml(c.value ?? "")}</code>`;
      if (c.type === "link" && typeof c.url === "string") {
        return `<a href="${escapeHtml(c.url)}">${renderInline(c.children ?? [])}</a>`;
      }
      if (c.type === "break") return "<br>";
      return escapeHtml(nodeToPlainText(c));
    })
    .join("");
}

function stripWrappingP(html: string): string {
  if (html.startsWith("<p>") && html.endsWith("</p>")) {
    return html.slice(3, -4);
  }
  return html;
}
