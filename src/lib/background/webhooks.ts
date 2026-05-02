import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";

const SUPPORTED_EVENTS = ["job.completed", "job.failed"] as const;
export type WebhookEvent = (typeof SUPPORTED_EVENTS)[number];

const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_USER_AGENT = "Extracto-Webhook/1.0";
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function isSupportedWebhookEvent(value: string): value is WebhookEvent {
  return (SUPPORTED_EVENTS as readonly string[]).includes(value);
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

function parseEventList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    return [];
  }
  return [];
}

export function serializeEventList(events: WebhookEvent[]): string {
  return JSON.stringify(events);
}

function signPayload(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | null | undefined,
  options?: { toleranceSeconds?: number; nowSeconds?: number }
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",");
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of parts) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") timestamp = Number(value);
    if (key === "v1") signature = value || null;
  }
  if (!timestamp || !Number.isFinite(timestamp) || !signature) return false;

  const tolerance =
    options?.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
  const now = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = signPayload(secret, body, timestamp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface JobEventPayload {
  id: string;
  status: import("@prisma/client").OcrJobStatus;
  fileName: string;
  model: string;
  errorMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
  processingMs: number | null;
  apiKeyId: string | null;
  batchId: string | null;
  userId: string | null;
}

async function fetchJobPayload(jobId: string): Promise<JobEventPayload | null> {
  const job = await db.ocrJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      fileName: true,
      model: true,
      errorMessage: true,
      completedAt: true,
      createdAt: true,
      processingMs: true,
      apiKeyId: true,
      batchId: true,
      userId: true,
    },
  });
  return job ?? null;
}

export async function dispatchJobWebhooks(
  jobId: string,
  event: WebhookEvent
): Promise<void> {
  const job = await fetchJobPayload(jobId);
  if (!job || !job.userId) return;

  const webhooks = await db.webhook.findMany({
    where: { userId: job.userId, active: true },
    select: { id: true, url: true, secret: true, events: true },
  });
  if (webhooks.length === 0) return;

  const matching = webhooks.filter((wh) => parseEventList(wh.events).includes(event));
  if (matching.length === 0) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    job: {
      id: job.id,
      status: job.status,
      fileName: job.fileName,
      model: job.model,
      errorMessage: job.errorMessage,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      processingMs: job.processingMs,
      apiKeyId: job.apiKeyId,
      batchId: job.batchId,
    },
  });

  await Promise.all(
    matching.map(async (webhook) => {
      const signature = signPayload(webhook.secret, body, timestamp);
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": WEBHOOK_USER_AGENT,
            "X-Extracto-Event": event,
            "X-Extracto-Signature": `t=${timestamp},v1=${signature}`,
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        await db.webhook
          .update({
            where: { id: webhook.id },
            data: { lastFiredAt: new Date(), failureCount: 0 },
          })
          .catch(() => undefined);
      } catch (error) {
        console.error(`Webhook ${webhook.id} delivery failed:`, error);
        await db.webhook
          .update({
            where: { id: webhook.id },
            data: { failureCount: { increment: 1 } },
          })
          .catch(() => undefined);
      } finally {
        clearTimeout(timeoutHandle);
      }
    })
  );
}
