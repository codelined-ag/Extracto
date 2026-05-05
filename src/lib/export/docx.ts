import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { RootContent } from "mdast";

import { nodeToPlainText, parseMarkdown } from "@/lib/export/markdown-ast";

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const ast = parseMarkdown(markdown);
  const children: Array<Paragraph | Table> = [];
  for (const node of ast.children) {
    pushBlock(children, node);
  }
  const doc = new Document({
    sections: [{ properties: {}, children }],
  });
  return await Packer.toBuffer(doc);
}

function pushBlock(out: Array<Paragraph | Table>, node: RootContent): void {
  switch (node.type) {
    case "heading": {
      const level = HEADING_LEVELS[node.depth] ?? HeadingLevel.HEADING_6;
      out.push(new Paragraph({ heading: level, children: inlineRuns(node.children) }));
      return;
    }
    case "paragraph": {
      out.push(new Paragraph({ children: inlineRuns(node.children) }));
      return;
    }
    case "list": {
      const ordered = Boolean(node.ordered);
      for (const [idx, item] of node.children.entries()) {
        const text = nodeToPlainText(item).trim();
        const bullet = ordered ? `${(node.start ?? 1) + idx}. ` : "• ";
        out.push(new Paragraph({ children: [new TextRun(bullet + text)] }));
      }
      return;
    }
    case "code": {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: node.value ?? "", font: "Courier New" })],
        }),
      );
      return;
    }
    case "blockquote": {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: nodeToPlainText(node), italics: true })],
        }),
      );
      return;
    }
    case "table": {
      const rows = node.children.map((row) =>
        row.children.map((cell) => nodeToPlainText(cell)),
      );
      out.push(buildTable(rows));
      return;
    }
    case "thematicBreak":
      out.push(new Paragraph({ children: [new TextRun("")] }));
      return;
    default:
      return;
  }
}

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  font?: string;
}

function inlineRuns(children: unknown[], style: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const child of children) {
    const c = child as { type: string; value?: string; children?: unknown[] };
    if (c.type === "text") runs.push(new TextRun({ text: c.value ?? "", ...style }));
    else if (c.type === "strong") runs.push(...inlineRuns(c.children ?? [], { ...style, bold: true }));
    else if (c.type === "emphasis") runs.push(...inlineRuns(c.children ?? [], { ...style, italics: true }));
    else if (c.type === "inlineCode") runs.push(new TextRun({ text: c.value ?? "", font: "Courier New", ...style }));
    else if (c.type === "link") runs.push(...inlineRuns(c.children ?? [], style));
    else if (c.type === "break") runs.push(new TextRun({ text: "", break: 1 }));
    else runs.push(new TextRun({ text: nodeToPlainText(c), ...style }));
  }
  return runs;
}

function buildTable(rows: string[][]): Table {
  const cols = Math.max(...rows.map((r) => r.length));
  const tableRows = rows.map((row, rowIdx) =>
    new TableRow({
      children: Array.from({ length: cols }, (_, colIdx) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: row[colIdx] ?? "", bold: rowIdx === 0 }),
              ],
            }),
          ],
        }),
      ),
    }),
  );
  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}
