import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { API_KEY_PREFIX } from "@/lib/auth/api-key-shared";

const RAW_KEY_BYTES = 32;
const PREFIX_DISPLAY_LENGTH = 6;

// Re-export edge-safe helpers so Node-only callers can import everything from one file.
export { API_KEY_PREFIX, extractBearerToken, isLikelyApiKey } from "@/lib/auth/api-key-shared";

function getApiKeySecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (!configured) {
    throw new Error("AUTH_SECRET is required");
  }
  return configured;
}

function base64UrlEncode(bytes: Buffer): string {
  return bytes.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function hashApiKey(plaintext: string): string {
  const secret = getApiKeySecret();
  return createHmac("sha256", secret).update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): { plaintext: string; prefix: string; keyHash: string } {
  const random = randomBytes(RAW_KEY_BYTES);
  const plaintext = `${API_KEY_PREFIX}${base64UrlEncode(random)}`;
  const prefix = plaintext.slice(0, API_KEY_PREFIX.length + PREFIX_DISPLAY_LENGTH);
  return {
    plaintext,
    prefix,
    keyHash: hashApiKey(plaintext),
  };
}

export function compareKeyHashes(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
