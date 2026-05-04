import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { normalizeSavedSearchFilters, normalizeSavedSearchName } from "@/lib/saved-searches";

interface SavedSearchInput extends Record<string, unknown> {
  name?: unknown;
  filters?: unknown;
}

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const rows = await db.savedSearch.findMany({
    where: { userId: auth.userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, filters: true, createdAt: true, updatedAt: true },
  });

  const tagIdSet = new Set<string>();
  for (const row of rows) {
    const f = row.filters as { tagIds?: unknown };
    if (Array.isArray(f?.tagIds)) {
      for (const id of f.tagIds) {
        if (typeof id === "string") tagIdSet.add(id);
      }
    }
  }
  const liveTagIds = new Set<string>();
  if (tagIdSet.size > 0) {
    const liveTags = await db.tag.findMany({
      where: { id: { in: Array.from(tagIdSet) }, userId: auth.userId },
      select: { id: true },
    });
    for (const tag of liveTags) liveTagIds.add(tag.id);
  }

  const savedSearches = rows.map((row) => {
    const f = row.filters as { tagIds?: unknown; [k: string]: unknown };
    if (Array.isArray(f?.tagIds)) {
      const pruned = (f.tagIds as unknown[]).filter(
        (id): id is string => typeof id === "string" && liveTagIds.has(id),
      );
      const next = { ...f };
      if (pruned.length > 0) next.tagIds = pruned;
      else delete next.tagIds;
      return { ...row, filters: next };
    }
    return row;
  });

  return NextResponse.json({ savedSearches });
});

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<SavedSearchInput>(request);
  const name = normalizeSavedSearchName(body.name);
  if (!name) throw new ApiRouteError("name is required", 400);
  const filters = normalizeSavedSearchFilters(body.filters);

  try {
    const saved = await db.savedSearch.upsert({
      where: { userId_name: { userId: auth.userId, name } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { userId: auth.userId, name, filters: filters as any },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: { filters: filters as any },
      select: { id: true, name: true, filters: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ savedSearch: saved });
  } catch (err) {
    throw new ApiRouteError(err instanceof Error ? err.message : "save failed", 500);
  }
});
