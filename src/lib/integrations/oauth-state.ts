import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { IntegrationProvider } from "@/lib/integrations/types";

const STATE_TTL_MS = 10 * 60 * 1000;

export const OAUTH_STATE_COOKIE = "extracto_oauth_state";

export function oauthStateCookieName(provider: IntegrationProvider): string {
  return `extracto_oauth_state_${provider}`;
}

export function timingSafeStateCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export interface OAuthStatePayload {
  userId: string;
  provider: IntegrationProvider;
  codeVerifier: string;
  nonce: string;
  expiresAt: number;
}

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is required for OAuth state");
  }
  return createHash("sha256").update(`oauth-state:${secret}`).digest();
}

export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function packOAuthState(input: {
  userId: string;
  provider: IntegrationProvider;
  codeVerifier: string;
}): string {
  const payload: OAuthStatePayload = {
    userId: input.userId,
    provider: input.provider,
    codeVerifier: input.codeVerifier,
    nonce: randomBytes(16).toString("base64url"),
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf-8").toString("base64url");
  const sig = createHmac("sha256", getKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function unpackOAuthState(value: string | undefined): OAuthStatePayload | null {
  if (!value || typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", getKey()).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const json = Buffer.from(body, "base64url").toString("utf-8");
    const payload = JSON.parse(json) as OAuthStatePayload;
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}
