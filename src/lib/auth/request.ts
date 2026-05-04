import { NextRequest, NextResponse } from "next/server";

import { Prisma } from "@prisma/client";

import { handleApiError } from "@/lib/api-error";
import {
  compareKeyHashes,
  extractBearerToken,
  hashApiKey,
  isLikelyApiKey,
} from "@/lib/auth/api-key";
import { parseScopeList, scopeListGrants, type Scope, type ScopeEntry, WILDCARD_SCOPE } from "@/lib/auth/scopes";
import { getAuthCookieName } from "@/lib/auth/token";
import { verifyActiveSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isTrustedMutationRequest } from "@/lib/request-security";
import { consumeSharedRateLimit } from "@/lib/rate-limit";

export type AuthMethod = "session" | "api-key";

export interface AuthContext {
  userId: string;
  method: AuthMethod;
  apiKeyId: string | null;
  scopes: ScopeEntry[];
  rateLimitPerMinute: number | null;
}

const API_KEY_RATE_LIMIT_WINDOW_MS = 60_000;
const STREAM_RATE_LIMIT_WINDOW_MS = 60_000;
const STREAM_RATE_LIMIT_MAX = 30;

interface ApiKeyVerifyResult {
  userId: string;
  apiKeyId: string;
  scopes: ScopeEntry[];
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
  const payload = await verifyActiveSession(token);
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

export async function enforceApiKeyRequestRateLimit(auth: AuthContext): Promise<NextResponse | null> {
  if (auth.method !== "api-key" || !auth.apiKeyId || !auth.rateLimitPerMinute || auth.rateLimitPerMinute <= 0) {
    return null;
  }
  const rateLimit = await consumeSharedRateLimit({
    key: `api:key:${auth.apiKeyId}`,
    max: auth.rateLimitPerMinute,
    windowMs: API_KEY_RATE_LIMIT_WINDOW_MS,
  });
  if (rateLimit.allowed) return null;
  return NextResponse.json(
    { error: "API key rate limit exceeded. Retry shortly." },
    { status: 429, headers: { "Retry-After": `${rateLimit.retryAfterSeconds}` } },
  );
}

export async function enforceStreamConnectionRateLimit(
  auth: AuthContext,
  streamName: string,
): Promise<NextResponse | null> {
  const principal = auth.method === "api-key" && auth.apiKeyId
    ? `key:${auth.apiKeyId}`
    : `user:${auth.userId}`;
  const rateLimit = await consumeSharedRateLimit({
    key: `stream:${streamName}:${principal}`,
    max: STREAM_RATE_LIMIT_MAX,
    windowMs: STREAM_RATE_LIMIT_WINDOW_MS,
  });
  if (rateLimit.allowed) return null;
  return NextResponse.json(
    { error: "Too many stream connections. Retry shortly." },
    { status: 429, headers: { "Retry-After": `${rateLimit.retryAfterSeconds}` } },
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

// ----------------------------------------------------------------------
// Higher-order route wrappers — eliminate the repeated boilerplate of
// (1) authenticate (2) check scope (3) wrap in try/catch + handleApiError
// that 12+ route handlers were carrying inline. Each wrapper passes the
// resolved AuthContext and the original Next.js context (with params)
// to the inner handler so handlers can focus on business logic.
// ----------------------------------------------------------------------

export type RouteHandlerContext<P = unknown> = {
  params: Promise<P>;
};

export type AuthenticatedHandler<P = unknown> = (
  request: NextRequest,
  ctx: RouteHandlerContext<P> & { auth: AuthContext },
) => Promise<Response | NextResponse> | Response | NextResponse;

type WrappedRouteHandler<P = unknown> = {
  (request: NextRequest): Promise<Response>;
  (request: NextRequest, ctx: RouteHandlerContext<P>): Promise<Response>;
};

/**
 * Wrap a GET-style handler with auth + scope check + handleApiError.
 * Uses authenticateRequest (cookie or bearer); does NOT enforce the
 * CSRF-style origin check — use withMutationAuth for state-changing
 * methods (POST/PUT/PATCH/DELETE).
 */
export function withAuth<P = unknown>(
  scope: Scope,
  handler: AuthenticatedHandler<P>,
): WrappedRouteHandler<P> {
  const wrapped = async (
    request: NextRequest,
    ctx?: RouteHandlerContext<P>,
  ): Promise<Response> => {
    try {
      const routeCtx = ctx ?? { params: Promise.resolve({} as P) };
      const auth = await authenticateRequest(request);
      if (!auth) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const scopeError = requireScope(auth, scope);
      if (scopeError) return scopeError;
      const rateLimitError = await enforceApiKeyRequestRateLimit(auth);
      if (rateLimitError) return rateLimitError;
      return await handler(request, { ...routeCtx, auth });
    } catch (error) {
      return handleApiError(error);
    }
  };

  return wrapped as WrappedRouteHandler<P>;
}

/**
 * Wrap a mutation handler (POST/PUT/PATCH/DELETE) with auth + origin
 * check + scope check + handleApiError.
 */
export function withMutationAuth<P = unknown>(
  scope: Scope,
  handler: AuthenticatedHandler<P>,
): WrappedRouteHandler<P> {
  const wrapped = async (
    request: NextRequest,
    ctx?: RouteHandlerContext<P>,
  ): Promise<Response> => {
    try {
      const routeCtx = ctx ?? { params: Promise.resolve({} as P) };
      const result = await authenticateMutation(request);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      const scopeError = requireScope(result.auth, scope);
      if (scopeError) return scopeError;
      const rateLimitError = await enforceApiKeyRequestRateLimit(result.auth);
      if (rateLimitError) return rateLimitError;
      return await handler(request, { ...routeCtx, auth: result.auth });
    } catch (error) {
      return handleApiError(error);
    }
  };

  return wrapped as WrappedRouteHandler<P>;
}

/**
 * Wrap a handler that may only be called from an interactive browser
 * session (not via API key). Used by the API-key management endpoints —
 * users mint and revoke keys via the UI, not via another key. The
 * interactive-only restriction means the operation always carries the
 * full session wildcard scope, so no additional scope arg is needed.
 *
 * `methodKind` selects whether the handler is read-only (no origin
 * check) or a mutation (CSRF-style origin check enforced).
 */
export function withSessionAuth<P = unknown>(
  methodKind: "read" | "mutation",
  resourceLabel: string,
  handler: AuthenticatedHandler<P>,
): WrappedRouteHandler<P> {
  const wrapped = async (
    request: NextRequest,
    ctx?: RouteHandlerContext<P>,
  ): Promise<Response> => {
    try {
      const routeCtx = ctx ?? { params: Promise.resolve({} as P) };
      let auth: AuthContext | null;
      if (methodKind === "mutation") {
        const result = await authenticateMutation(request);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: result.status });
        }
        auth = result.auth;
      } else {
        auth = await authenticateRequest(request);
        if (!auth) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
      }

      if (auth.method !== "session") {
        const verb = methodKind === "mutation" ? "modified" : "viewed";
        return NextResponse.json(
          { error: `${resourceLabel} can only be ${verb} via an interactive session` },
          { status: 403 },
        );
      }

      return await handler(request, { ...routeCtx, auth });
    } catch (error) {
      return handleApiError(error);
    }
  };

  return wrapped as WrappedRouteHandler<P>;
}
