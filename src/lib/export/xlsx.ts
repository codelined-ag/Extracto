import ExcelJS from "exceljs";

import { extractTables, type TableData } from "@/lib/export/tables";

export async function markdownToXlsx(markdown: string): Promise<Buffer> {
  const tables = extractTables(markdown);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Extracto";

  if (tables.length === 0) {
    const sheet = workbook.addWorksheet("Text");
    sheet.addRow(["text"]);
    for (const line of markdown.split(/\r?\n/)) {
      sheet.addRow([line]);
    }
  } else {
    for (const [index, table] of tables.entries()) {
      const sheet = workbook.addWorksheet(`Table ${index + 1}`);
      writeTable(sheet, table);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function writeTable(sheet: ExcelJS.Worksheet, table: TableData): void {
  if (table.header.length > 0) {
    sheet.addRow(table.header);
    sheet.getRow(1).font = { bold: true };
  }
  for (const row of table.rows) {
    sheet.addRow(row);
  }
  for (let i = 1; i <= Math.max(table.header.length, ...table.rows.map((r) => r.length)); i += 1) {
    const col = sheet.getColumn(i);
    let max = 8;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(60, max + 2);
  }
}
