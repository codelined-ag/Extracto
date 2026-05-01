import { NextRequest, NextResponse } from "next/server";

import { generateApiKey } from "@/lib/auth/api-key";
import { authenticateMutation, authenticateRequest } from "@/lib/auth/request";
import {
  ALL_SCOPES,
  normalizeRequestedScopes,
  parseScopeList,
  serializeScopeList,
} from "@/lib/auth/scopes";
import { db } from "@/lib/db";

const MAX_KEY_NAME_LENGTH = 64;
const MAX_KEYS_PER_USER = 20;
const MAX_RATE_LIMIT_PER_MINUTE = 600;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (auth.method !== "session") {
    return NextResponse.json(
      { error: "API keys can only be listed via an interactive session" },
      { status: 403 }
    );
  }
  const userId = auth.userId;

  const rows = await db.apiKey.findMany({
    where: { userId },
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
}

export async function POST(request: NextRequest) {
  const result = await authenticateMutation(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.auth.method !== "session") {
    return NextResponse.json(
      { error: "API keys can only be created via an interactive session" },
      { status: 403 }
    );
  }
  const userId = result.auth.userId;

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    scopes?: unknown;
    rateLimitPerMinute?: unknown;
  };
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  if (!rawName) {
    return NextResponse.json({ error: "Key name is required" }, { status: 400 });
  }
  if (rawName.length > MAX_KEY_NAME_LENGTH) {
    return NextResponse.json(
      { error: `Key name must be at most ${MAX_KEY_NAME_LENGTH} characters` },
      { status: 400 }
    );
  }

  const scopes = normalizeRequestedScopes(body.scopes);

  let rateLimitPerMinute: number | null = null;
  if (body.rateLimitPerMinute !== undefined && body.rateLimitPerMinute !== null) {
    const raw = Number(body.rateLimitPerMinute);
    if (!Number.isFinite(raw) || raw < 1 || raw > MAX_RATE_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        { error: `rateLimitPerMinute must be between 1 and ${MAX_RATE_LIMIT_PER_MINUTE}` },
        { status: 400 }
      );
    }
    rateLimitPerMinute = Math.trunc(raw);
  }

  const activeCount = await db.apiKey.count({
    where: { userId, revokedAt: null },
  });
  if (activeCount >= MAX_KEYS_PER_USER) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_KEYS_PER_USER} active API keys per user` },
      { status: 409 }
    );
  }

  const { plaintext, prefix, keyHash } = generateApiKey();
  const created = await db.apiKey.create({
    data: {
      userId,
      name: rawName,
      prefix,
      keyHash,
      scopes: serializeScopeList(scopes),
      rateLimitPerMinute,
    },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });

  return NextResponse.json(
    {
      key: { ...created, scopes, rateLimitPerMinute, plaintext },
      warning:
        "Store this key now — it will not be shown again. Use it as Authorization: Bearer <key>.",
    },
    { status: 201 }
  );
}
