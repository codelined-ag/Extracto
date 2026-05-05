import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { lookup as dnsLookup } from "node:dns";

import { db } from "@/lib/db";
import { parseAllowlist, resolveAndCheckExternalUrl } from "@/lib/url-safety";

const SUPPORTED_EVENTS = [
  "job.created",
  "job.completed",
  "job.failed",
  "watcher.ingested",
] as const;
export type WebhookEvent = (typeof SUPPORTED_EVENTS)[number];

export const ALL_WEBHOOK_EVENTS: readonly WebhookEvent[] = SUPPORTED_EVENTS;

const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_USER_AGENT = "Extracto-Webhook/1.0";
const WEBHOOK_MAX_REDIRECTS = 5;
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
export const WEBHOOK_AUTO_DISABLE_THRESHOLD = 20;
export const WEBHOOK_RETRY_BACKOFF_SECONDS = [60, 300, 1800, 7200, 43200] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_BACKOFF_SECONDS.length + 1;

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

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveRedirectLocation(currentUrl: string, location: string): string {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    throw new Error(`Webhook redirect from ${currentUrl} returned an invalid Location header`);
  }
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function headersToObject(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function responseHeaders(rawHeaders: import("node:http").IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

async function fetchWithBoundLookup(
  rawUrl: string,
  init: RequestInit,
  lookup: typeof dnsLookup,
): Promise<Response> {
  const url = new URL(rawUrl);
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
  const signal = init.signal;
  if (signal?.aborted) {
    throw abortError();
  }

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(error);
    };
    const finishResponse = (response: Response) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(response);
    };
    const onAbort = () => {
      req.destroy(abortError());
    };

    const req = requestImpl(url, {
      method: init.method ?? "GET",
      headers: headersToObject(init.headers),
      lookup,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("error", finishError);
      res.on("end", () => {
        finishResponse(new Response(Buffer.concat(chunks), {
          status: res.statusCode ?? 500,
          statusText: res.statusMessage,
          headers: responseHeaders(res.headers),
        }));
      });
    });

    req.on("error", finishError);
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    if (typeof init.body === "string" || Buffer.isBuffer(init.body)) {
      req.write(init.body);
    } else if (init.body != null) {
      req.write(String(init.body));
    }
    req.end();
  });
}

async function fetchWebhookWithValidatedRedirects(
  initialUrl: string,
  init: RequestInit,
  allowlist: string[],
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= WEBHOOK_MAX_REDIRECTS; redirects += 1) {
    const safety = await resolveAndCheckExternalUrl(currentUrl, allowlist);
    if (!safety.ok) {
      throw new Error(`Refusing delivery to ${currentUrl}: ${safety.reason}`);
    }

    const response = safety.lookup
      ? await fetchWithBoundLookup(currentUrl, init, safety.lookup)
      : await fetch(currentUrl, {
          ...init,
          redirect: "manual",
        });
    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    if (redirects === WEBHOOK_MAX_REDIRECTS) {
      throw new Error(`Webhook redirect limit exceeded for ${initialUrl}`);
    }
    currentUrl = resolveRedirectLocation(currentUrl, location);
  }

  throw new Error(`Webhook redirect limit exceeded for ${initialUrl}`);
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
    matching.map((webhook) => attemptWebhookDelivery({ webhook, event, body, timestamp })),
  );
}

/**
 * Fire-and-forget broadcast for non-job events (e.g. comparison or watcher
 * ingest). Same signing + SSRF policy as the job dispatch path; the body
 * shape is defined by the caller.
 */
export async function dispatchUserWebhooks(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const webhooks = await db.webhook.findMany({
    where: { userId, active: true },
    select: { id: true, url: true, secret: true, events: true },
  });
  const matching = webhooks.filter((wh) => parseEventList(wh.events).includes(event));
  if (matching.length === 0) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ event, occurredAt: new Date().toISOString(), ...payload });

  await Promise.all(
    matching.map((webhook) => attemptWebhookDelivery({ webhook, event, body, timestamp })),
  );
}

interface AttemptInput {
  webhook: { id: string; url: string; secret: string };
  event: WebhookEvent;
  body: string;
  timestamp: number;
}

export async function dispatchTestWebhook(
  userId: string,
  webhookId: string,
): Promise<{ ok: boolean; statusCode: number | null; errorMessage: string | null }> {
  const webhook = await db.webhook.findFirst({
    where: { id: webhookId, userId },
    select: { id: true, url: true, secret: true, events: true },
  });
  if (!webhook) {
    return { ok: false, statusCode: null, errorMessage: "Webhook not found" };
  }
  let events: WebhookEvent[] = [];
  try {
    const parsed = JSON.parse(webhook.events);
    if (Array.isArray(parsed)) {
      events = parsed.filter((e): e is WebhookEvent => typeof e === "string" && isSupportedWebhookEvent(e));
    }
  } catch {
    events = [];
  }
  const event = events[0] ?? "job.completed";
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    test: true,
    webhookId: webhook.id,
    message: "Synthetic delivery from POST /api/v1/webhooks/{id}/test",
  });
  const before = await db.webhookDelivery.count({ where: { webhookId: webhook.id } });
  await attemptWebhookDelivery({ webhook, event, body, timestamp });
  const after = await db.webhookDelivery.findFirst({
    where: { webhookId: webhook.id },
    orderBy: { attemptedAt: "desc" },
    select: { ok: true, statusCode: true, errorMessage: true },
  });
  if (!after || (await db.webhookDelivery.count({ where: { webhookId: webhook.id } })) === before) {
    return { ok: false, statusCode: null, errorMessage: "Delivery row missing" };
  }
  return {
    ok: after.ok,
    statusCode: after.statusCode ?? null,
    errorMessage: after.errorMessage ?? null,
  };
}

async function attemptWebhookDelivery({ webhook, event, body, timestamp, deliveryId, attempt = 0 }: AttemptInput & { deliveryId?: string; attempt?: number }): Promise<void> {
  const signature = signPayload(webhook.secret, body, timestamp);
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  const startedAt = Date.now();
  let statusCode: number | null = null;
  let ok = false;
  let errorMessage: string | null = null;
  try {
    const response = await fetchWebhookWithValidatedRedirects(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": WEBHOOK_USER_AGENT,
        "X-Extracto-Event": event,
        "X-Extracto-Signature": `t=${timestamp},v1=${signature}`,
      },
      body,
      signal: controller.signal,
    }, parseAllowlist(process.env.WEBHOOK_ALLOWED_HOSTS));
    statusCode = response.status;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    ok = true;
    await db.webhook
      .update({
        where: { id: webhook.id },
        data: { lastFiredAt: new Date(), failureCount: 0 },
      })
      .catch(() => undefined);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    console.error(`Webhook ${webhook.id} delivery failed (attempt ${attempt + 1}):`, error);
    const updated = await db.webhook
      .update({
        where: { id: webhook.id },
        data: { failureCount: { increment: 1 } },
        select: { failureCount: true, active: true },
      })
      .catch(() => null);
    if (
      updated &&
      updated.active === true &&
      typeof updated.failureCount === "number" &&
      updated.failureCount >= WEBHOOK_AUTO_DISABLE_THRESHOLD
    ) {
      await db.webhook
        .update({ where: { id: webhook.id }, data: { active: false } })
        .catch(() => undefined);
      console.warn(`Webhook ${webhook.id} auto-disabled after ${updated.failureCount} consecutive failures`);
    }
  } finally {
    clearTimeout(timeoutHandle);
    const nextAttempt = attempt + 1;
    const status = ok
      ? "delivered"
      : nextAttempt >= WEBHOOK_MAX_ATTEMPTS
        ? "exhausted"
        : "pending";
    const backoffSlot = Math.min(attempt, WEBHOOK_RETRY_BACKOFF_SECONDS.length - 1);
    const nextRetryAt = status === "pending"
      ? new Date(Date.now() + WEBHOOK_RETRY_BACKOFF_SECONDS[backoffSlot] * 1000)
      : null;
    const data = {
      event,
      url: webhook.url,
      statusCode: statusCode ?? null,
      ok,
      durationMs: Date.now() - startedAt,
      errorMessage,
      attempt: nextAttempt,
      status,
      nextRetryAt,
      attemptedAt: new Date(),
      ...(status !== "delivered" ? { body } : { body: null }),
    };
    if (deliveryId) {
      await db.webhookDelivery
        .update({ where: { id: deliveryId }, data })
        .catch(() => undefined);
    } else {
      await db.webhookDelivery
        .create({ data: { webhookId: webhook.id, ...data } })
        .catch(() => undefined);
    }
  }
}

const RETRY_SWEEP_MS = 60_000;
const RETRY_BATCH_SIZE = 50;
let retrySweepStarted = false;
let sweepInFlight = false;

export async function sweepDueWebhookRetries(now: Date = new Date()): Promise<{ retried: number }> {
  if (sweepInFlight) return { retried: 0 };
  sweepInFlight = true;
  try {
    const due = await db.webhookDelivery.findMany({
      where: { status: "pending", nextRetryAt: { lte: now } },
      orderBy: { nextRetryAt: "asc" },
      take: RETRY_BATCH_SIZE,
      select: {
        id: true,
        event: true,
        body: true,
        attempt: true,
        webhook: { select: { id: true, url: true, secret: true, active: true } },
      },
    });
    let retried = 0;
    for (const row of due) {
      if (!row.webhook.active) {
        await db.webhookDelivery
          .update({ where: { id: row.id }, data: { status: "exhausted", nextRetryAt: null } })
          .catch(() => undefined);
        continue;
      }
      if (!row.body) {
        console.warn(`[webhook-retry] delivery ${row.id} has no body, exhausting`);
        await db.webhookDelivery
          .update({ where: { id: row.id }, data: { status: "exhausted", nextRetryAt: null } })
          .catch(() => undefined);
        continue;
      }
      if (!isSupportedWebhookEvent(row.event)) continue;
      const timestamp = Math.floor(Date.now() / 1000);
      await attemptWebhookDelivery({
        webhook: { id: row.webhook.id, url: row.webhook.url, secret: row.webhook.secret },
        event: row.event,
        body: row.body,
        timestamp,
        deliveryId: row.id,
        attempt: row.attempt,
      });
      retried += 1;
    }
    return { retried };
  } finally {
    sweepInFlight = false;
  }
}

export function startWebhookRetrySweep(): void {
  if (retrySweepStarted) return;
  retrySweepStarted = true;
  void sweepDueWebhookRetries().catch((err) => console.error("[webhook-retry] initial sweep failed", err));
  setInterval(() => {
    void sweepDueWebhookRetries().catch((err) => console.error("[webhook-retry] sweep failed", err));
  }, RETRY_SWEEP_MS).unref?.();
}
