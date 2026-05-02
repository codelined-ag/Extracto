import { NextRequest, NextResponse } from "next/server";

import { authenticateMutation } from "@/lib/auth/request";
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
    if (result.auth.method !== "session") {
      return NextResponse.json(
        { error: "API keys can only be revoked via an interactive session" },
        { status: 403 }
      );
    }
    const userId = result.auth.userId;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Key id is required" }, { status: 400 });
    }

    const updated = await db.apiKey.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ revoked: updated.count });
  } catch (error) {
    return handleApiError(error);
  }
}
