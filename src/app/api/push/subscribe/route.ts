import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withAuth, withMutationAuth } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { resolvePushHostAllowlist, validatePushEndpoint } from "@/lib/push/endpoint-policy";
import { getPublicVapidKey } from "@/lib/push/vapid";

interface SubscribeBody extends Record<string, unknown> {
  endpoint?: unknown;
  keys?: unknown;
  userAgent?: unknown;
}

interface UnsubscribeBody extends Record<string, unknown> {
  endpoint?: unknown;
}

export const GET = withAuth("settings:read", async () => {
  const publicKey = await getPublicVapidKey();
  return NextResponse.json({ publicKey });
});

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<SubscribeBody>(request);
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const keys = body.keys && typeof body.keys === "object" && !Array.isArray(body.keys)
    ? (body.keys as Record<string, unknown>)
    : null;
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
  const authKey = typeof keys?.auth === "string" ? keys.auth : "";
  if (!endpoint || !p256dh || !authKey) {
    throw new ApiRouteError("endpoint and keys.{p256dh,auth} are required", 400);
  }
  if (endpoint.length > 1024 || p256dh.length > 256 || authKey.length > 128) {
    throw new ApiRouteError("subscription field too long", 400);
  }
  const policy = validatePushEndpoint(endpoint, resolvePushHostAllowlist());
  if (!policy.ok) {
    throw new ApiRouteError(policy.reason ?? "endpoint host is not an allowed push service", 400);
  }
  const userAgent = typeof body.userAgent === "string" ? body.userAgent.slice(0, 200) : null;

  await db.pushSubscription.deleteMany({
    where: { endpoint, userId: { not: auth.userId } },
  });

  const sub = await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: auth.userId, endpoint, p256dh, auth: authKey, userAgent },
    update: { userId: auth.userId, p256dh, auth: authKey, userAgent, failureCount: 0 },
    select: { id: true, endpoint: true, createdAt: true },
  });
  return NextResponse.json({ subscription: sub });
});

export const DELETE = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<UnsubscribeBody>(request);
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  if (!endpoint) throw new ApiRouteError("endpoint is required", 400);
  await db.pushSubscription.deleteMany({ where: { userId: auth.userId, endpoint } });
  return NextResponse.json({ deleted: true });
});
