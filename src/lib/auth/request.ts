import { NextRequest } from "next/server";

import {
  compareKeyHashes,
  extractBearerToken,
  hashApiKey,
  isLikelyApiKey,
} from "@/lib/auth/api-key";
import { getAuthCookieName, verifySessionToken } from "@/lib/auth/token";
import { db } from "@/lib/db";
import { isTrustedMutationRequest } from "@/lib/request-security";

export type AuthMethod = "session" | "api-key";

export interface AuthContext {
  userId: string;
  method: AuthMethod;
}

async function verifyApiKeyToken(token: string): Promise<string | null> {
  if (!isLikelyApiKey(token)) {
    return null;
  }

  let candidateHash: string;
  try {
    candidateHash = hashApiKey(token);
  } catch {
    return null;
  }

  const record = await db.apiKey.findUnique({
    where: { keyHash: candidateHash },
    select: { id: true, userId: true, keyHash: true, revokedAt: true },
  });

  if (!record || record.revokedAt) {
    return null;
  }

  if (!compareKeyHashes(record.keyHash, candidateHash)) {
    return null;
  }

  void db.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return record.userId;
}

export async function authenticateRequest(
  request: NextRequest
): Promise<AuthContext | null> {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  if (bearer) {
    const apiUserId = await verifyApiKeyToken(bearer);
    if (apiUserId) {
      return { userId: apiUserId, method: "api-key" };
    }
    return null;
  }

  const token = request.cookies.get(getAuthCookieName())?.value;
  const payload = await verifySessionToken(token);
  if (!payload) {
    return null;
  }
  return { userId: payload.userId, method: "session" };
}

export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const auth = await authenticateRequest(request);
  return auth?.userId ?? null;
}

export type MutationAuthFailure =
  | { ok: false; status: 401; error: "Unauthorized" }
  | { ok: false; status: 403; error: "Invalid request origin" };

export type MutationAuthResult =
  | { ok: true; auth: AuthContext }
  | MutationAuthFailure;

export async function authenticateMutation(
  request: NextRequest
): Promise<MutationAuthResult> {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (auth.method === "session" && !isTrustedMutationRequest(request)) {
    return { ok: false, status: 403, error: "Invalid request origin" };
  }
  return { ok: true, auth };
}
