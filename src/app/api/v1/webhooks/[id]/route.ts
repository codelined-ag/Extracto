import { ApiRouteError } from "@/lib/api-error";
import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import {
  isSupportedWebhookEvent,
  serializeEventList,
  type WebhookEvent,
} from "@/lib/background/webhooks";
import { isAllowedExternalUrl, parseAllowlist } from "@/lib/url-safety";

const MAX_URL_LENGTH = 1024;

function parseEventsArray(input: unknown): WebhookEvent[] | null {
  if (!Array.isArray(input)) return null;
  const out: WebhookEvent[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") return null;
    const lowered = entry.trim().toLowerCase();
    if (!isSupportedWebhookEvent(lowered)) return null;
    if (!out.includes(lowered as WebhookEvent)) out.push(lowered as WebhookEvent);
  }
  if (out.length === 0) return null;
  return out;
}

export const DELETE = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (_request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Webhook id is required", 400);
    }

    const deleted = await db.webhook.deleteMany({ where: { id, userId: auth.userId } });
    if (deleted.count === 0) {
      throw new ApiRouteError("Webhook not found", 404);
    }

    return NextResponse.json({ deleted: deleted.count });
  },
);

export const PATCH = withMutationAuth<{ id: string }>(
  "webhooks:write",
  async (request: NextRequest, { params, auth }) => {
    const { id } = await params;
    if (!id) {
      throw new ApiRouteError("Webhook id is required", 400);
    }

    const body = await parseJsonBody<{ active?: unknown; url?: unknown; events?: unknown }>(request);
    const data: { active?: boolean; url?: string; events?: string } = {};

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        throw new ApiRouteError("active must be a boolean", 400);
      }
      data.active = body.active;
    }

    if (body.url !== undefined) {
      const trimmed = typeof body.url === "string" ? body.url.trim() : "";
      if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
        throw new ApiRouteError("url must be a non-empty https/http URL", 400);
      }
      const safety = isAllowedExternalUrl(trimmed, parseAllowlist(process.env.WEBHOOK_ALLOWED_HOSTS));
      if (!safety.ok) {
        throw new ApiRouteError(safety.reason ?? "url is not allowed", 400);
      }
      data.url = trimmed;
    }

    if (body.events !== undefined) {
      const parsed = parseEventsArray(body.events);
      if (!parsed) throw new ApiRouteError("events must be a non-empty array of supported event names", 400);
      data.events = serializeEventList(parsed);
    }

    if (Object.keys(data).length === 0) {
      throw new ApiRouteError("At least one of active, url, or events is required", 400);
    }

    const updated = await db.webhook.updateMany({
      where: { id, userId: auth.userId },
      data,
    });
    if (updated.count === 0) {
      throw new ApiRouteError("Webhook not found", 404);
    }
    return NextResponse.json({ updated: updated.count });
  },
);
