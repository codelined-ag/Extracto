import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const GET = withAuth<{ id: string }>(
  "settings:read",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    const template = await db.ocrJobTemplate.findFirst({ where: { id, userId: auth.userId } });
    if (!template) throw new ApiRouteError("Template not found", 404);
    return NextResponse.json({ template });
  },
);

export const DELETE = withMutationAuth<{ id: string }>(
  "settings:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    const result = await db.ocrJobTemplate.deleteMany({ where: { id, userId: auth.userId } });
    if (result.count === 0) throw new ApiRouteError("Template not found", 404);
    return NextResponse.json({ deleted: true });
  },
);
