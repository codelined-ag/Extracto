import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION_PREFIX = "v1:";

function getKey(domain: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is required for at-rest encryption");
  }
  return createHash("sha256").update(`${domain}:${secret}`).digest();
}

export function encryptAtRest(plaintext: string, domain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(domain), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptAtRest(payload: string, domain: string): string {
  if (!payload.startsWith(VERSION_PREFIX)) return payload;
  const buf = Buffer.from(payload.slice(VERSION_PREFIX.length), "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("encrypted blob is corrupt");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const enc = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getKey(domain), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf-8");
}

export function isEncryptedAtRest(value: string): boolean {
  return value.startsWith(VERSION_PREFIX);
}
