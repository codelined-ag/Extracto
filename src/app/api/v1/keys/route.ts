import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api-error";
import { generateApiKey } from "@/lib/auth/api-key";
import { withSessionAuth } from "@/lib/auth/request";
import {
  ALL_SCOPES,
  normalizeRequestedScopes,
  parseScopeList,
  serializeScopeList,
  ScopeValidationError,
} from "@/lib/auth/scopes";
import { db } from "@/lib/db";

const MAX_KEY_NAME_LENGTH = 64;
const MAX_KEYS_PER_USER = 20;
const MAX_RATE_LIMIT_PER_MINUTE = 600;

export const GET = withSessionAuth("read", "API keys", async (_request: NextRequest, { auth }) => {
  const rows = await db.apiKey.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      rateLimitPerMinute: true,
      totalRequests: true,
      requestsThisMonth: true,
      monthlyResetAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  const keys = rows.map((row) => ({
    ...row,
    scopes: parseScopeList(row.scopes),
  }));

  return NextResponse.json({ keys, availableScopes: ALL_SCOPES });
});

export const POST = withSessionAuth("mutation", "API keys", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<{
    name?: unknown;
    scopes?: unknown;
    rateLimitPerMinute?: unknown;
  }>(request);
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    throw new ApiRouteError("Key name is required", 400);
  }
  if (rawName.length > MAX_KEY_NAME_LENGTH) {
    throw new ApiRouteError(`Key name must be at most ${MAX_KEY_NAME_LENGTH} characters`, 400);
  }

  let scopes: string[];
  try {
    scopes = normalizeRequestedScopes(body.scopes);
  } catch (error) {
    if (error instanceof ScopeValidationError) {
      throw new ApiRouteError(error.message, 400);
    }
    throw error;
  }

  let rateLimitPerMinute: number | null = null;
  if (body.rateLimitPerMinute !== undefined && body.rateLimitPerMinute !== null) {
    const raw = Number(body.rateLimitPerMinute);
    if (!Number.isFinite(raw) || raw < 1 || raw > MAX_RATE_LIMIT_PER_MINUTE) {
      throw new ApiRouteError(`rateLimitPerMinute must be between 1 and ${MAX_RATE_LIMIT_PER_MINUTE}`, 400);
    }
    rateLimitPerMinute = Math.trunc(raw);
  }

  const activeCount = await db.apiKey.count({
    where: { userId: auth.userId, revokedAt: null },
  });
  if (activeCount >= MAX_KEYS_PER_USER) {
    throw new ApiRouteError(`Maximum of ${MAX_KEYS_PER_USER} active API keys per user`, 409);
  }

  const { plaintext, prefix, keyHash } = generateApiKey();
  const created = await db.apiKey.create({
    data: {
      userId: auth.userId,
      name: rawName,
      prefix,
      keyHash,
      scopes: serializeScopeList(scopes),
      rateLimitPerMinute,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      rateLimitPerMinute: true,
      totalRequests: true,
      requestsThisMonth: true,
      monthlyResetAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      key: { ...created, scopes, plaintext },
      warning:
        "Store this key now — it will not be shown again. Use it as Authorization: Bearer <key>.",
    },
    { status: 201 }
  );
});
