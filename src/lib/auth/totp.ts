import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { AuthUser } from "@prisma/client";

import { db } from "@/lib/db";
import { decryptAtRest, encryptAtRest, isEncryptedAtRest } from "@/lib/auth/secret-at-rest";

const TOTP_DOMAIN = "totp";

export function encryptTotpSecret(secret: string): string {
  return encryptAtRest(secret, TOTP_DOMAIN);
}

function decryptStoredTotpSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isEncryptedAtRest(stored)) return stored;
  try {
    return decryptAtRest(stored, TOTP_DOMAIN);
  } catch {
    return null;
  }
}

const ISSUER = "Extracto";
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 8;
const TOTP_WINDOW = 1;

export interface TotpEnrollment {
  secret: string;
  otpauthUrl: string;
  qrPngDataUrl: string;
  recoveryCodes: string[];
}

interface RecoveryCodeRecord {
  hash: string;
  salt: string;
  used?: boolean;
}

export async function generateTotpEnrollment(user: Pick<AuthUser, "email">): Promise<TotpEnrollment> {
  const secret = generateSecret();
  const otpauthUrl = generateURI({
    strategy: "totp",
    secret,
    label: user.email,
    issuer: ISSUER,
  });
  const qrPngDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, scale: 6 });
  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  return { secret, otpauthUrl, qrPngDataUrl, recoveryCodes };
}

export function verifyStoredTotpCode(storedSecret: string, token: string): boolean {
  const plaintext = decryptStoredTotpSecret(storedSecret);
  if (!plaintext) return false;
  return verifyTotpCode(plaintext, token);
}

export function verifyTotpCode(secret: string, token: string): boolean {
  if (!secret || !token) return false;
  const cleaned = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  const result = verifySync({
    strategy: "totp",
    token: cleaned,
    secret,
    epochTolerance: TOTP_WINDOW * 30,
  });
  return result.valid === true;
}

function generateRecoveryCode(): string {
  const raw = randomBytes(RECOVERY_CODE_BYTES).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export function hashRecoveryCodes(codes: string[]): RecoveryCodeRecord[] {
  return codes.map((code) => {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(normalizeRecoveryCode(code), salt, 64).toString("hex");
    return { hash, salt };
  });
}

function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}

function recoveryCodeMatches(code: string, record: RecoveryCodeRecord): boolean {
  const computed = scryptSync(normalizeRecoveryCode(code), record.salt, 64);
  const stored = Buffer.from(record.hash, "hex");
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

export function readRecoveryRecords(raw: unknown): RecoveryCodeRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map((entry) => ({
      hash: typeof entry.hash === "string" ? entry.hash : "",
      salt: typeof entry.salt === "string" ? entry.salt : "",
      used: entry.used === true,
    }))
    .filter((entry) => entry.hash && entry.salt);
}

export async function consumeRecoveryCode(userId: string, supplied: string): Promise<boolean> {
  const user = await db.authUser.findUnique({
    where: { id: userId },
    select: { totpRecoveryCodesHash: true },
  });
  const records = readRecoveryRecords(user?.totpRecoveryCodesHash);
  if (records.length === 0) return false;
  let matchedIndex = -1;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.used) continue;
    if (recoveryCodeMatches(supplied, record)) {
      matchedIndex = i;
      break;
    }
  }
  if (matchedIndex === -1) return false;
  const next = records.map((record, idx) =>
    idx === matchedIndex ? { ...record, used: true } : record,
  );
  const before = (user?.totpRecoveryCodesHash ?? null) as unknown;
  const updated = await db.authUser.updateMany({
    where: {
      id: userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      totpRecoveryCodesHash: before as any,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { totpRecoveryCodesHash: next as any },
  });
  return updated.count === 1;
}

export async function verifyTotpForUser(
  userId: string,
  supplied: string,
): Promise<"totp" | "recovery" | null> {
  const user = await db.authUser.findUnique({
    where: { id: userId },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user || !user.totpEnabled || !user.totpSecret) return null;
  const secret = decryptStoredTotpSecret(user.totpSecret);
  if (!secret) return null;
  if (!isEncryptedAtRest(user.totpSecret)) {
    await db.authUser
      .update({ where: { id: userId }, data: { totpSecret: encryptTotpSecret(secret) } })
      .catch(() => undefined);
  }
  if (verifyTotpCode(secret, supplied)) return "totp";
  if (await consumeRecoveryCode(userId, supplied)) return "recovery";
  return null;
}
