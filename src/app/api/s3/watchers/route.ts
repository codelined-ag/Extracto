import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";

interface WatcherInput extends Record<string, unknown> {
  name?: unknown;
  prefix?: unknown;
  intervalSeconds?: unknown;
  active?: unknown;
  model?: unknown;
  templateId?: unknown;
  autoKbExport?: unknown;
  autoS3Export?: unknown;
}

const MIN_INTERVAL = 30;
const MAX_INTERVAL = 86400;

function normalize(input: WatcherInput) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw new ApiRouteError("name is required", 400);
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model) throw new ApiRouteError("model is required", 400);

  const prefix = typeof input.prefix === "string" ? input.prefix.trim().replace(/^\/+|\/+$/g, "").slice(0, 200) : "";
  const intervalRaw = typeof input.intervalSeconds === "number" ? Math.trunc(input.intervalSeconds) : MIN_INTERVAL;
  const intervalSeconds = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, intervalRaw));

  return {
    name,
    prefix,
    intervalSeconds,
    active: input.active === undefined ? true : Boolean(input.active),
    model,
    templateId: typeof input.templateId === "string" ? input.templateId : null,
    autoKbExport: Boolean(input.autoKbExport),
    autoS3Export: Boolean(input.autoS3Export),
  };
}

export const GET = withAuth("settings:read", async (_request: NextRequest, { auth }) => {
  const watchers = await db.watchedS3Source.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ watchers });
});

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<WatcherInput>(request);
  const data = normalize(body);
  const watcher = await db.watchedS3Source.upsert({
    where: { userId_name: { userId: auth.userId, name: data.name } },
    create: { userId: auth.userId, ...data },
    update: data,
  });
  return NextResponse.json({ watcher });
});
