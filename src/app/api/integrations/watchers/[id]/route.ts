import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { isCloudProvider } from "@/lib/integrations/dispatch";

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 86400;

interface UpdateInput extends Record<string, unknown> {
  name?: unknown;
  folderPath?: unknown;
  intervalSeconds?: unknown;
  active?: unknown;
  model?: unknown;
  templateId?: unknown;
  autoKbExport?: unknown;
  autoS3Export?: unknown;
}

export const PATCH = withSessionAuth<{ id: string }>(
  "mutation",
  "Cloud watcher",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    const body = await parseJsonBody<UpdateInput>(request);
    const existing = await db.watchedCloudFolder.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new ApiRouteError("Watcher not found", 404);
    if (!isCloudProvider(existing.provider)) throw new ApiRouteError("Invalid provider", 400);

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const next = body.name.trim().slice(0, 80);
      if (!next) throw new ApiRouteError("name cannot be empty", 400);
      update.name = next;
    }
    if (typeof body.folderPath === "string") update.folderPath = body.folderPath.trim().slice(0, 400);
    if (typeof body.intervalSeconds === "number") {
      const v = Math.trunc(body.intervalSeconds);
      update.intervalSeconds = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, v));
    }
    if (body.active !== undefined) update.active = Boolean(body.active);
    if (typeof body.model === "string" && body.model.trim()) update.model = body.model.trim();
    if (body.templateId !== undefined) {
      update.templateId = typeof body.templateId === "string" ? body.templateId : null;
    }
    if (body.autoKbExport !== undefined) update.autoKbExport = Boolean(body.autoKbExport);
    if (body.autoS3Export !== undefined) update.autoS3Export = Boolean(body.autoS3Export);

    if (update.active === true) {
      update.consecutiveFailures = 0;
      update.lastError = null;
    }

    try {
      const updated = await db.watchedCloudFolder.update({ where: { id }, data: update });
      return NextResponse.json({ watcher: updated });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw new ApiRouteError("A watcher with that name already exists for this provider", 409);
      }
      throw err;
    }
  },
);

export const DELETE = withSessionAuth<{ id: string }>(
  "mutation",
  "Cloud watcher",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    const existing = await db.watchedCloudFolder.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new ApiRouteError("Watcher not found", 404);
    await db.watchedCloudFolder.delete({ where: { id } });
    return NextResponse.json({ id, removed: true });
  },
);
