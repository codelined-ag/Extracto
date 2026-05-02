import { NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import {
  compareKeyHashes,
  extractBearerToken,
  hashApiKey,
  isLikelyApiKey,
} from "@/lib/auth/api-key";
import { parseScopeList, scopeListGrants, type Scope, WILDCARD_SCOPE } from "@/lib/auth/scopes";
import { getAuthCookieName, verifySessionToken } from "@/lib/auth/token";
import { db } from "@/lib/db";
import { isTrustedMutationRequest } from "@/lib/request-security";

export type AuthMethod = "session" | "api-key";

export interface AuthContext {
  userId: string;
  method: AuthMethod;
  apiKeyId: string | null;
  scopes: string[];
  rateLimitPerMinute: number | null;
}

interface ApiKeyVerifyResult {
  userId: string;
  apiKeyId: string;
  scopes: string[];
  rateLimitPerMinute: number | null;
}

function startOfNextMonth(now: Date): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
}

async function verifyApiKeyToken(token: string): Promise<ApiKeyVerifyResult | null> {
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
    select: {
      id: true,
      userId: true,
      keyHash: true,
      revokedAt: true,
      scopes: true,
      rateLimitPerMinute: true,
      monthlyResetAt: true,
    },
  });

  if (!record || record.revokedAt) {
    return null;
  }

  if (!compareKeyHashes(record.keyHash, candidateHash)) {
    return null;
  }

  const now = new Date();
  const nextReset = startOfNextMonth(now);

  // Atomic CASE update so concurrent requests racing across the month
  // boundary cannot both observe `shouldReset` and clobber each other's
  // counter. SQLite evaluates the CASE against the row's current value.
  void db
    .$executeRaw(Prisma.sql`
      UPDATE "ApiKey"
      SET
        "lastUsedAt" = ${now},
        "totalRequests" = "totalRequests" + 1,
        "monthlyResetAt" = CASE
          WHEN "monthlyResetAt" IS NULL OR "monthlyResetAt" <= ${now}
            THEN ${nextReset}
          ELSE "monthlyResetAt"
        END,
        "requestsThisMonth" = CASE
          WHEN "monthlyResetAt" IS NULL OR "monthlyResetAt" <= ${now}
            THEN 1
          ELSE "requestsThisMonth" + 1
        END
      WHERE "id" = ${record.id}
    `)
    .catch(() => undefined);

  return {
    userId: record.userId,
    apiKeyId: record.id,
    scopes: parseScopeList(record.scopes),
    rateLimitPerMinute: record.rateLimitPerMinute ?? null,
  };
}

export async function authenticateRequest(
  request: NextRequest
): Promise<AuthContext | null> {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  if (bearer) {
    const result = await verifyApiKeyToken(bearer);
    if (result) {
      return {
        userId: result.userId,
        method: "api-key",
        apiKeyId: result.apiKeyId,
        scopes: result.scopes,
        rateLimitPerMinute: result.rateLimitPerMinute,
      };
    }
    return null;
  }

  const token = request.cookies.get(getAuthCookieName())?.value;
  const payload = await verifySessionToken(token);
  if (!payload) {
    return null;
  }
  return {
    userId: payload.userId,
    method: "session",
    apiKeyId: null,
    scopes: [WILDCARD_SCOPE],
    rateLimitPerMinute: null,
  };
}

export function authHasScope(auth: AuthContext, scope: Scope): boolean {
  return scopeListGrants(auth.scopes, scope);
}

export function requireScope(auth: AuthContext, scope: Scope): NextResponse | null {
  if (authHasScope(auth, scope)) return null;
  return NextResponse.json(
    { error: `Missing required scope: ${scope}` },
    { status: 403 }
  );
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
