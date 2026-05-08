import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { withSessionAuth } from "@/lib/auth/request";
import {
  normalizeRequestedScopes,
  parseScopeList,
  serializeScopeList,
  ScopeValidationError,
} from "@/lib/auth/scopes";
import { db } from "@/lib/db";

const MAX_RATE_LIMIT_PER_MINUTE = 600;

export const PATCH = withSessionAuth<{ id: string }>(
  "mutation",
  "API keys",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Key id is required", 400);

    const body = await parseJsonBody<{
      scopes?: unknown;
      rateLimitPerMinute?: unknown;
      name?: unknown;
    }>(request);

    const data: { scopes?: string; rateLimitPerMinute?: number | null; name?: string } = {};

    if (body.scopes !== undefined) {
      try {
        data.scopes = serializeScopeList(normalizeRequestedScopes(body.scopes));
      } catch (error) {
        if (error instanceof ScopeValidationError) {
          throw new ApiRouteError(error.message, 400);
        }
        throw error;
      }
    }

    if (body.rateLimitPerMinute !== undefined) {
      if (body.rateLimitPerMinute === null) {
        data.rateLimitPerMinute = null;
      } else {
        const raw = Number(body.rateLimitPerMinute);
        if (!Number.isFinite(raw) || raw < 1 || raw > MAX_RATE_LIMIT_PER_MINUTE) {
          throw new ApiRouteError(`rateLimitPerMinute must be between 1 and ${MAX_RATE_LIMIT_PER_MINUTE}`, 400);
        }
        data.rateLimitPerMinute = Math.trunc(raw);
      }
    }

    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (!trimmed) throw new ApiRouteError("name cannot be empty", 400);
      if (trimmed.length > 64) throw new ApiRouteError("name must be at most 64 characters", 400);
      data.name = trimmed;
    }

    if (Object.keys(data).length === 0) {
      throw new ApiRouteError("At least one of scopes, rateLimitPerMinute, or name is required", 400);
    }

    const updated = await db.apiKey.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data,
    });
    if (updated.count === 0) throw new ApiRouteError("Key not found", 404);

    const row = await db.apiKey.findFirst({
      where: { id, userId: auth.userId },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        rateLimitPerMinute: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    return NextResponse.json({
      key: row ? { ...row, scopes: parseScopeList(row.scopes) } : null,
    });
  },
);

export const DELETE = withSessionAuth<{ id: string }>(
  "mutation",
  "API keys",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Key id is required", 400);
    }

    const updated = await db.apiKey.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (updated.count === 0) {
      throw new ApiRouteError("Key not found", 404);
    }

    return NextResponse.json({ revoked: updated.count });
  },
);
