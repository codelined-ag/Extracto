import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { normalizeTagColor, normalizeTagName } from "@/lib/tags";

interface TagInput extends Record<string, unknown> {
  name?: unknown;
  color?: unknown;
}

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const tags = await db.tag.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      color: true,
      createdAt: true,
      _count: { select: { jobTags: true } },
    },
  });
  return NextResponse.json({
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      createdAt: t.createdAt,
      jobCount: t._count.jobTags,
    })),
  });
});

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<TagInput>(request);
  const name = normalizeTagName(body.name);
  if (!name) throw new ApiRouteError("name is required", 400);
  const color = normalizeTagColor(body.color);

  try {
    const tag = await db.tag.upsert({
      where: { userId_name: { userId: auth.userId, name } },
      create: { userId: auth.userId, name, color },
      update: { color },
      select: { id: true, name: true, color: true, createdAt: true },
    });
    return NextResponse.json({ tag });
  } catch (err) {
    throw new ApiRouteError(err instanceof Error ? err.message : "save failed", 500);
  }
});
