import { NextRequest, NextResponse } from "next/server";

import { handleApiError, parseJsonBody } from "@/lib/api-error";
import { authenticateMutation, requireScope } from "@/lib/auth/request";
import { db } from "@/lib/db";

const MAX_NAME_LENGTH = 80;
const MAX_INSTRUCTION_LENGTH = 6000;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateMutation(request);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const scopeError = requireScope(result.auth, "presets:write");
    if (scopeError) return scopeError;
    const userId = result.auth.userId;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Preset id is required" }, { status: 400 });
    }

    const body = await parseJsonBody<{
      name?: unknown;
      instruction?: unknown;
      outputFormat?: unknown;
    }>(request);

    const data: Record<string, string> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name || name.length > MAX_NAME_LENGTH) {
        return NextResponse.json({ error: "Invalid name" }, { status: 400 });
      }
      data.name = name;
    }
    if (typeof body.instruction === "string") {
      const instruction = body.instruction.trim();
      if (!instruction || instruction.length > MAX_INSTRUCTION_LENGTH) {
        return NextResponse.json({ error: "Invalid instruction" }, { status: 400 });
      }
      data.instruction = instruction;
    }
    if (body.outputFormat === "markdown" || body.outputFormat === "json") {
      data.outputFormat = body.outputFormat;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await db.outputPreset.updateMany({
      where: { id, userId },
      data,
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }
    return NextResponse.json({ updated: updated.count });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateMutation(request);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const scopeError = requireScope(result.auth, "presets:write");
    if (scopeError) return scopeError;
    const userId = result.auth.userId;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Preset id is required" }, { status: 400 });
    }

    const deleted = await db.outputPreset.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: deleted.count });
  } catch (error) {
    return handleApiError(error);
  }
}
