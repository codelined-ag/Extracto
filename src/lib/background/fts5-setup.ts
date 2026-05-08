import { db } from "@/lib/db";

let setupDone = false;
let ftsAvailable = false;

export function isFtsAvailable(): boolean {
  return ftsAvailable;
}

interface SqliteMaster {
  name: string;
}

export async function setupOcrJobFts(): Promise<{ created: boolean; rebuilt: boolean }> {
  if (setupDone) return { created: false, rebuilt: false };
  setupDone = true;

  try {
    const existing = await db.$queryRawUnsafe<SqliteMaster[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='OcrJobFts'`,
    );
    const alreadyExists = Array.isArray(existing) && existing.length > 0;

    if (!alreadyExists) {
      await db.$executeRawUnsafe(`
        CREATE VIRTUAL TABLE OcrJobFts USING fts5(
          fileName,
          extractedText,
          content='OcrJob',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        )
      `);
      await db.$executeRawUnsafe(`
        CREATE TRIGGER OcrJob_ai_fts AFTER INSERT ON OcrJob WHEN new.extractedText IS NOT NULL BEGIN
          INSERT INTO OcrJobFts(rowid, fileName, extractedText)
          VALUES (new.rowid, new.fileName, new.extractedText);
        END
      `);
      await db.$executeRawUnsafe(`
        CREATE TRIGGER OcrJob_ad_fts AFTER DELETE ON OcrJob BEGIN
          INSERT INTO OcrJobFts(OcrJobFts, rowid, fileName, extractedText)
          VALUES('delete', old.rowid, old.fileName, old.extractedText);
        END
      `);
      await db.$executeRawUnsafe(`
        CREATE TRIGGER OcrJob_au_fts AFTER UPDATE OF extractedText, fileName ON OcrJob BEGIN
          INSERT INTO OcrJobFts(OcrJobFts, rowid, fileName, extractedText)
          VALUES('delete', old.rowid, old.fileName, old.extractedText);
          INSERT INTO OcrJobFts(rowid, fileName, extractedText)
          VALUES (new.rowid, new.fileName, new.extractedText);
        END
      `);
      await db.$executeRawUnsafe(`INSERT INTO OcrJobFts(OcrJobFts) VALUES('rebuild')`);
      ftsAvailable = true;
      console.log("[fts5] OcrJobFts virtual table created and backfilled");
      return { created: true, rebuilt: true };
    }

    ftsAvailable = true;
    return { created: false, rebuilt: false };
  } catch (err) {
    ftsAvailable = false;
    console.warn("[fts5] setup failed; falling back to instr() search:", err);
    return { created: false, rebuilt: false };
  }
}

const FTS_TOKEN_TRIM = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export function buildFtsMatchExpression(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const tokens = trimmed
    .split(/\s+/)
    .map((tok) => tok.replace(FTS_TOKEN_TRIM, ""))
    .filter((tok) => tok.length > 0)
    .map((tok) => `"${tok.replace(/"/g, '""')}"*`);
  if (tokens.length === 0) return null;
  return tokens.join(" AND ");
}
