import { NextRequest, NextResponse } from "next/server";

import { authenticateMutation, authenticateRequest, requireScope } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { handleApiError, parseJsonBody } from "@/lib/api-error";

const MAX_NAME_LENGTH = 80;
const MAX_INSTRUCTION_LENGTH = 6000;
const MAX_PRESETS_PER_USER = 50;

function validateOutputFormat(value: unknown): "markdown" | "json" | null {
  if (value === "markdown" || value === "json") return value;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const scopeError = requireScope(auth, "presets:read");
    if (scopeError) return scopeError;

    const presets = await db.outputPreset.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        instruction: true,
        outputFormat: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ presets });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const result = await authenticateMutation(request);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const scopeError = requireScope(result.auth, "presets:write");
    if (scopeError) return scopeError;
    const userId = result.auth.userId;

    const body = await parseJsonBody<{
      name?: unknown;
      instruction?: unknown;
      outputFormat?: unknown;
    }>(request);

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    const outputFormat = validateOutputFormat(body.outputFormat) ?? "markdown";

    if (!name || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `name is required and must be at most ${MAX_NAME_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (!instruction || instruction.length > MAX_INSTRUCTION_LENGTH) {
      return NextResponse.json(
        {
          error: `instruction is required and must be at most ${MAX_INSTRUCTION_LENGTH} characters`,
        },
        { status: 400 }
      );
    }

    const count = await db.outputPreset.count({ where: { userId } });
    if (count >= MAX_PRESETS_PER_USER) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_PRESETS_PER_USER} presets per user` },
        { status: 409 }
      );
    }

    const created = await db.outputPreset.create({
      data: { userId, name, instruction, outputFormat },
      select: {
        id: true,
        name: true,
        instruction: true,
        outputFormat: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ preset: created }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
