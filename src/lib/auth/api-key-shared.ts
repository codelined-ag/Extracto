// Edge-runtime-safe subset — no Node:crypto. Import from api-key.ts in Node-only contexts.
// middleware.ts uses this file directly because Edge runtime forbids Node built-ins.
export const API_KEY_PREFIX = "extr_";

export function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) return null;
  const token = match[1].trim();
  return token || null;
}

export function isLikelyApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}
