import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const CHALLENGE_TTL_SECONDS = 5 * 60;
const KIND = "2fa_challenge" as const;

const consumedJtis = new Map<string, number>();

function pruneConsumed(now: number): void {
  for (const [jti, exp] of consumedJtis) {
    if (exp <= now) consumedJtis.delete(jti);
  }
}

export function consumeTwoFactorChallengeJti(jti: string, expSeconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (consumedJtis.size > 1000) pruneConsumed(now);
  if (consumedJtis.has(jti)) return false;
  consumedJtis.set(jti, expSeconds);
  return true;
}

export interface TwoFactorChallengePayload {
  userId: string;
  email: string;
  exp: number;
  jti: string;
  kind: typeof KIND;
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET?.trim();
  if (!s) throw new Error("AUTH_SECRET is required");
  return s;
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function createTwoFactorChallengeToken(input: { userId: string; email: string }): string {
  const claims: TwoFactorChallengePayload = {
    ...input,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS,
    jti: randomBytes(16).toString("hex"),
    kind: KIND,
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(claims));
  const sig = createHmac("sha256", getSecret()).update(payloadEncoded).digest();
  return `${payloadEncoded}.${base64UrlEncode(sig)}`;
}

export function verifyTwoFactorChallengeToken(
  token: string | null | undefined,
): TwoFactorChallengePayload | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expectedSig = createHmac("sha256", getSecret()).update(payload).digest();
  const givenSig = base64UrlDecode(sig);
  if (givenSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(givenSig, expectedSig)) return null;
  let claims: TwoFactorChallengePayload;
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString("utf8")) as TwoFactorChallengePayload;
  } catch {
    return null;
  }
  if (claims.kind !== KIND) return null;
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}
