import { db } from "@/lib/db";
import { resolvePushHostAllowlist, validatePushEndpoint } from "@/lib/push/endpoint-policy";
import { getVapidKeys, webpush } from "@/lib/push/vapid";

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

export async function dispatchPushForJob(jobId: string, payload: PushPayload): Promise<void> {
  const job = await db.ocrJob.findUnique({
    where: { id: jobId },
    select: { userId: true },
  });
  if (!job?.userId) return;
  await dispatchPushToUser(job.userId, payload);
}

export async function dispatchPushToUser(userId: string, payload: PushPayload): Promise<void> {
  await getVapidKeys();
  const subs = await db.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return;

  const body = JSON.stringify(payload);
  const stale: string[] = [];
  const allowlist = resolvePushHostAllowlist();
  await Promise.all(
    subs.map(async (sub) => {
      const policy = validatePushEndpoint(sub.endpoint, allowlist);
      if (!policy.ok) {
        stale.push(sub.id);
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 600 },
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          stale.push(sub.id);
        } else {
          console.warn(`[push] delivery to ${sub.endpoint.slice(0, 40)}... failed:`, err);
        }
      }
    }),
  );
  if (stale.length > 0) {
    await db.pushSubscription.deleteMany({ where: { id: { in: stale } } }).catch(() => undefined);
  }
}
