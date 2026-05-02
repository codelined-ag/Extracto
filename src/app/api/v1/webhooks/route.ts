import { NextRequest, NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import {
  generateWebhookSecret,
  isSupportedWebhookEvent,
  serializeEventList,
  type WebhookEvent,
} from "@/lib/background/webhooks";

const MAX_WEBHOOKS_PER_USER = 20;
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

export const GET = withAuth("webhooks:read", async (_request: NextRequest, { auth }) => {
  const rows = await db.webhook.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      events: true,
      active: true,
      lastFiredAt: true,
      failureCount: true,
      createdAt: true,
    },
  });

  const webhooks = rows.map((row) => {
    let events: string[] = [];
    try {
      const parsed = JSON.parse(row.events);
      if (Array.isArray(parsed)) {
        events = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      events = [];
    }
    return { ...row, events };
  });

  return NextResponse.json({ webhooks });
});

export const POST = withMutationAuth("webhooks:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<{
    url?: unknown;
    events?: unknown;
    active?: unknown;
  }>(request);

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url || url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "url must be a non-empty https/http URL" }, { status: 400 });
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "url is not a valid URL" }, { status: 400 });
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return NextResponse.json({ error: "url must be http or https" }, { status: 400 });
  }

  const events = parseEventsArray(body.events) ?? (["job.completed", "job.failed"] as WebhookEvent[]);

  const count = await db.webhook.count({ where: { userId: auth.userId } });
  if (count >= MAX_WEBHOOKS_PER_USER) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_WEBHOOKS_PER_USER} webhooks per user` },
      { status: 409 }
    );
  }

  const secret = generateWebhookSecret();
  const created = await db.webhook.create({
    data: {
      userId: auth.userId,
      url,
      secret,
      events: serializeEventList(events),
      active: body.active === false ? false : true,
    },
    select: { id: true, url: true, events: true, active: true, createdAt: true },
  });

  return NextResponse.json(
    {
      webhook: { ...created, events, secret },
      warning:
        "Store this signing secret now — it will not be shown again. Verify deliveries with the X-Extracto-Signature header.",
    },
    { status: 201 }
  );
});
