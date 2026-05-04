import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { normalizeProvider } from "@/lib/api-types";

interface TemplateInput extends Record<string, unknown> {
  name?: unknown;
  description?: unknown;
  model?: unknown;
  provider?: unknown;
  preset?: unknown;
  language?: unknown;
  customPrompt?: unknown;
  postProcessing?: unknown;
  autoExports?: unknown;
}

const VALID_PRESETS = new Set(["generic", "academic", "invoice", "contract", "form"]);

function normalize(input: TemplateInput) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw new ApiRouteError("name is required", 400);

  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model) throw new ApiRouteError("model is required", 400);

  const providerRaw = typeof input.provider === "string" ? input.provider : "";
  const provider = normalizeProvider(providerRaw);

  const preset = typeof input.preset === "string" && VALID_PRESETS.has(input.preset)
    ? input.preset
    : "generic";

  const language = typeof input.language === "string" ? input.language.trim().slice(0, 16) || "auto" : "auto";
  const customPrompt = typeof input.customPrompt === "string" ? input.customPrompt.slice(0, 4000) : "";
  const description = typeof input.description === "string" ? input.description.slice(0, 200) : null;

  const MAX_JSON_BYTES = 32 * 1024;
  const sizedJson = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return null;
    const json = JSON.stringify(value);
    if (json.length > MAX_JSON_BYTES) {
      throw new ApiRouteError(`Template JSON field exceeds ${MAX_JSON_BYTES} bytes`, 413);
    }
    return value;
  };
  const postProcessing = sizedJson(input.postProcessing);
  const autoExports = sizedJson(input.autoExports);

  return { name, description, model, provider, preset, language, customPrompt, postProcessing, autoExports };
}

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const templates = await db.ocrJobTemplate.findMany({
    where: { userId: auth.userId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ templates });
});

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<TemplateInput>(request);
  const data = normalize(body);

  try {
    const template = await db.ocrJobTemplate.upsert({
      where: { userId_name: { userId: auth.userId, name: data.name } },
      create: {
        userId: auth.userId,
        ...data,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        postProcessing: data.postProcessing as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        autoExports: data.autoExports as any,
      },
      update: {
        ...data,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        postProcessing: data.postProcessing as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        autoExports: data.autoExports as any,
      },
    });
    return NextResponse.json({ template });
  } catch (err) {
    throw new ApiRouteError(err instanceof Error ? err.message : "save failed", 500);
  }
});
