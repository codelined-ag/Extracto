import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { db } from "@/lib/db";
import {
  decryptAtRest,
  encryptAtRest,
  isEncryptedAtRest,
} from "@/lib/auth/secret-at-rest";

const WEBHOOK_SECRET_DOMAIN = "webhook-secret";
const S3_SECRET_DOMAIN = "s3-credentials";

async function migrateWebhookSecrets(): Promise<{ upgraded: number }> {
  let upgraded = 0;
  try {
    const rows = await db.webhook.findMany({ select: { id: true, secret: true } });
    for (const row of rows) {
      if (!row.secret || isEncryptedAtRest(row.secret)) continue;
      try {
        const enc = encryptAtRest(row.secret, WEBHOOK_SECRET_DOMAIN);
        await db.webhook.update({ where: { id: row.id }, data: { secret: enc } });
        upgraded += 1;
      } catch (err) {
        console.warn(`[secret-migration] webhook ${row.id} re-encrypt failed:`, err);
      }
    }
  } catch (err) {
    console.warn("[secret-migration] webhook scan failed:", err);
  }
  return { upgraded };
}

function getS3DefaultsDir(): string | null {
  const envDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!envDatabaseUrl?.startsWith("file:")) return null;
  return path.join(path.dirname(envDatabaseUrl.replace(/^file:/u, "")), "s3-defaults");
}

async function migrateS3Secrets(): Promise<{ upgraded: number }> {
  const dir = getS3DefaultsDir();
  if (!dir) return { upgraded: 0 };
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { upgraded: 0 };
  }
  let upgraded = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { secretAccessKey?: string };
      if (!parsed.secretAccessKey || isEncryptedAtRest(parsed.secretAccessKey)) continue;
      const enc = encryptAtRest(parsed.secretAccessKey, S3_SECRET_DOMAIN);
      const next = { ...parsed, secretAccessKey: enc };
      await writeFile(filePath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
      upgraded += 1;
    } catch (err) {
      console.warn(`[secret-migration] s3 file ${entry} re-encrypt failed:`, err);
    }
  }
  return { upgraded };
}

let started = false;

export async function runSecretMigrationOnce(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const w = await migrateWebhookSecrets();
    const s = await migrateS3Secrets();
    if (w.upgraded > 0 || s.upgraded > 0) {
      console.log(`[secret-migration] upgraded ${w.upgraded} webhook secret(s), ${s.upgraded} S3 credential file(s)`);
    }
  } catch (err) {
    console.warn("[secret-migration] failed:", err);
  }
  void decryptAtRest; // keep import live; helper used by adapters at read time
}
