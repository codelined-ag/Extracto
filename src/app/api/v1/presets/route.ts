import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

const MAX_NAME_LENGTH = 80;
const MAX_INSTRUCTION_LENGTH = 6000;
const MAX_PRESETS_PER_USER = 50;

function validateOutputFormat(value: unknown): "markdown" | "json" | null {
  if (value === "markdown" || value === "json") return value;
  return null;
}

export const GET = withAuth("presets:read", async (_request: NextRequest, { auth }) => {
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
});

export const POST = withMutationAuth("presets:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<{
    name?: unknown;
    instruction?: unknown;
    outputFormat?: unknown;
  }>(request);

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const outputFormat = validateOutputFormat(body.outputFormat) ?? "markdown";

  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new ApiRouteError(`name is required and must be at most ${MAX_NAME_LENGTH} characters`, 400);
  }
  if (!instruction || instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new ApiRouteError(`instruction is required and must be at most ${MAX_INSTRUCTION_LENGTH} characters`, 400);
  }

  const count = await db.outputPreset.count({ where: { userId: auth.userId } });
  if (count >= MAX_PRESETS_PER_USER) {
    throw new ApiRouteError(`Maximum of ${MAX_PRESETS_PER_USER} presets per user`, 409);
  }

  const created = await db.outputPreset.create({
    data: { userId: auth.userId, name, instruction, outputFormat },
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
});
