import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { isTagColor, normalizeTagName } from "@/lib/tags";

interface TagPatch extends Record<string, unknown> {
  name?: unknown;
  color?: unknown;
}

export const PATCH = withMutationAuth<{ id: string }>(
  "settings:write",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Tag id is required", 400);
    const body = await parseJsonBody<TagPatch>(request);
    const data: { name?: string; color?: string } = {};
    if (body.name !== undefined) {
      const name = normalizeTagName(body.name);
      if (!name) throw new ApiRouteError("name must be non-empty", 400);
      data.name = name;
    }
    if (body.color !== undefined) {
      if (!isTagColor(body.color)) throw new ApiRouteError("invalid color", 400);
      data.color = body.color;
    }
    if (Object.keys(data).length === 0) throw new ApiRouteError("No mutable fields supplied", 400);

    if (data.name) {
      const conflict = await db.tag.findFirst({
        where: { userId: auth.userId, name: data.name, NOT: { id } },
        select: { id: true },
      });
      if (conflict) throw new ApiRouteError("A tag with that name already exists", 409);
    }
    const result = await db.tag.updateMany({
      where: { id, userId: auth.userId },
      data,
    });
    if (result.count === 0) throw new ApiRouteError("Tag not found", 404);
    const tag = await db.tag.findUnique({
      where: { id },
      select: { id: true, name: true, color: true, createdAt: true },
    });
    return NextResponse.json({ tag });
  },
);

export const DELETE = withMutationAuth<{ id: string }>(
  "settings:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) throw new ApiRouteError("Tag id is required", 400);
    const result = await db.tag.deleteMany({
      where: { id, userId: auth.userId },
    });
    if (result.count === 0) throw new ApiRouteError("Tag not found", 404);
    return NextResponse.json({ deleted: result.count });
  },
);
