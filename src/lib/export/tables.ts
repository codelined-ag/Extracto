import type { Root, Table } from "mdast";

import { nodeToPlainText, parseMarkdown } from "@/lib/export/markdown-ast";

export interface TableData {
  header: string[];
  rows: string[][];
}

export function extractTables(markdown: string): TableData[] {
  const ast = parseMarkdown(markdown);
  const tables: TableData[] = [];
  walk(ast, (node) => {
    if (node.type === "table") {
      tables.push(tableToData(node as Table));
    }
  });
  return tables;
}

function tableToData(table: Table): TableData {
  const rows = table.children.map((row) => row.children.map((cell) => nodeToPlainText(cell)));
  const cols = Math.max(...rows.map((r) => r.length), 0);
  const padded = rows.map((row) => Array.from({ length: cols }, (_, i) => row[i] ?? ""));
  const [first, ...rest] = padded;
  return { header: first ?? [], rows: rest };
}

function walk(root: Root, fn: (node: { type: string }) => void): void {
  const stack: Array<{ type: string; children?: unknown[] }> = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    fn(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        stack.push(child as { type: string; children?: unknown[] });
      }
    }
  }
}
