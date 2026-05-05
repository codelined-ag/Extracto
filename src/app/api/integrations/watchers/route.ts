import { NextResponse, type NextRequest } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withSessionAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { isCloudProvider, isWatcherProvider } from "@/lib/integrations/dispatch";

const MIN_INTERVAL = 60;
const MAX_INTERVAL = 86400;

interface WatcherInput extends Record<string, unknown> {
  provider?: unknown;
  name?: unknown;
  folderPath?: unknown;
  intervalSeconds?: unknown;
  active?: unknown;
  model?: unknown;
  templateId?: unknown;
  autoKbExport?: unknown;
  autoS3Export?: unknown;
}

function normalize(input: WatcherInput) {
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!isWatcherProvider(provider)) throw new ApiRouteError("provider must be dropbox, google_drive, onedrive, or local", 400);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw new ApiRouteError("name is required", 400);
  const model = typeof input.model === "string" ? input.model.trim() : "";
  if (!model) throw new ApiRouteError("model is required", 400);

  const folderPath = typeof input.folderPath === "string" ? input.folderPath.trim().slice(0, 400) : "";
  const intervalRaw =
    typeof input.intervalSeconds === "number" ? Math.trunc(input.intervalSeconds) : MIN_INTERVAL;
  const intervalSeconds = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, intervalRaw));

  return {
    provider,
    name,
    folderPath,
    intervalSeconds,
    active: input.active === undefined ? true : Boolean(input.active),
    model,
    templateId: typeof input.templateId === "string" ? input.templateId : null,
    autoKbExport: Boolean(input.autoKbExport),
    autoS3Export: Boolean(input.autoS3Export),
  };
}

export const GET = withSessionAuth(
  "read",
  "Cloud watchers",
  async (_request: NextRequest, { auth }) => {
    const watchers = await db.watchedCloudFolder.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
    });
    const counts = watchers.length === 0
      ? new Map<string, number>()
      : await db.watchedCloudObject
          .groupBy({
            by: ["sourceId"],
            where: { sourceId: { in: watchers.map((w) => w.id) } },
            _count: { sourceId: true },
          })
          .then((rows) => new Map(rows.map((r) => [r.sourceId, r._count.sourceId])));
    return NextResponse.json({
      watchers: watchers.map((w) => ({ ...w, ingestedCount: counts.get(w.id) ?? 0 })),
    });
  },
);

export const POST = withSessionAuth(
  "mutation",
  "Cloud watchers",
  async (request: NextRequest, { auth }) => {
    const body = await parseJsonBody<WatcherInput>(request);
    const data = normalize(body);
    if (isCloudProvider(data.provider)) {
      const connection = await db.integrationConnection.findUnique({
        where: { userId_provider: { userId: auth.userId, provider: data.provider } },
        select: { provider: true },
      });
      if (!connection) {
        throw new ApiRouteError(
          `Connect ${data.provider} before creating a watcher for it`,
          400,
        );
      }
    }
    try {
      const created = await db.watchedCloudFolder.create({
        data: { ...data, userId: auth.userId },
      });
      return NextResponse.json({ watcher: created }, { status: 201 });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw new ApiRouteError("A watcher with that name already exists for this provider", 409);
      }
      throw err;
    }
  },
);
