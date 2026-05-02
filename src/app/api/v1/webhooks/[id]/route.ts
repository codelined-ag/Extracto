import { NextRequest, NextResponse } from "next/server";

import { authenticateMutation, requireScope } from "@/lib/auth/request";
import { handleApiError } from "@/lib/api-error";
import { db } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateMutation(request);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const scopeError = requireScope(result.auth, "webhooks:write");
    if (scopeError) return scopeError;
    const userId = result.auth.userId;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Webhook id is required" }, { status: 400 });
    }

    const deleted = await db.webhook.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: deleted.count });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateMutation(request);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const scopeError = requireScope(result.auth, "webhooks:write");
    if (scopeError) return scopeError;
    const userId = result.auth.userId;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Webhook id is required" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { active?: unknown };
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active (boolean) is required" }, { status: 400 });
    }

    const updated = await db.webhook.updateMany({
      where: { id, userId },
      data: { active: body.active },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
    }
    return NextResponse.json({ updated: updated.count });
  } catch (error) {
    return handleApiError(error);
  }
}
