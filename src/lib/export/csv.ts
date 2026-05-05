import { extractTables, type TableData } from "@/lib/export/tables";

const BOM = "﻿";
const CRLF = "\r\n";

export function markdownToCsv(markdown: string): string {
  const tables = extractTables(markdown);
  if (tables.length === 0) {
    return BOM + rowsToCsv([["text"], ...markdown.split(/\r?\n/).map((line) => [line])]);
  }
  if (tables.length === 1) {
    return BOM + tableToCsv(tables[0]);
  }
  const sections: string[] = [];
  for (const [index, table] of tables.entries()) {
    sections.push(`# table ${index + 1}`);
    sections.push(tableToCsv(table));
    sections.push("");
  }
  return BOM + sections.join(CRLF);
}

function tableToCsv(table: TableData): string {
  const cols = Math.max(table.header.length, ...table.rows.map((r) => r.length), 0);
  const padded = (row: string[]) => Array.from({ length: cols }, (_, i) => row[i] ?? "");
  return rowsToCsv([padded(table.header), ...table.rows.map(padded)]);
}

function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(",")).join(CRLF);
}

function escapeCsvField(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}
