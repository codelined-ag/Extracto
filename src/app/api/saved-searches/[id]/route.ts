import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { normalizeSavedSearchFilters, normalizeSavedSearchName } from "@/lib/saved-searches";

interface SavedSearchPatch extends Record<string, unknown> {
  name?: unknown;
  filters?: unknown;
}

export const PATCH = withMutationAuth<{ id: string }>(
  "settings:write",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Saved search id is required", 400);
    const body = await parseJsonBody<SavedSearchPatch>(request);

    const data: { name?: string; filters?: unknown } = {};
    if (body.name !== undefined) {
      const name = normalizeSavedSearchName(body.name);
      if (!name) throw new ApiRouteError("name must be non-empty", 400);
      const conflict = await db.savedSearch.findFirst({
        where: { userId: auth.userId, name, NOT: { id } },
        select: { id: true },
      });
      if (conflict) throw new ApiRouteError("A saved search with that name already exists", 409);
      data.name = name;
    }
    if (body.filters !== undefined) {
      data.filters = normalizeSavedSearchFilters(body.filters);
    }
    if (Object.keys(data).length === 0) throw new ApiRouteError("No mutable fields supplied", 400);

    const result = await db.savedSearch.updateMany({
      where: { id, userId: auth.userId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: data as any,
    });
    if (result.count === 0) throw new ApiRouteError("Saved search not found", 404);

    const saved = await db.savedSearch.findUnique({
      where: { id },
      select: { id: true, name: true, filters: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ savedSearch: saved });
  },
);

export const DELETE = withMutationAuth<{ id: string }>(
  "settings:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Saved search id is required", 400);
    const result = await db.savedSearch.deleteMany({
      where: { id, userId: auth.userId },
    });
    if (result.count === 0) throw new ApiRouteError("Saved search not found", 404);
    return NextResponse.json({ deleted: result.count });
  },
);
