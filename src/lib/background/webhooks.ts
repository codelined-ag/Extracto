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
    matching.map(async (webhook) => {
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
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        ok = true;
        await db.webhook
          .update({
            where: { id: webhook.id },
            data: { lastFiredAt: new Date(), failureCount: 0 },
          })
          .catch(() => undefined);
      } catch (error) {
        errorMessage = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
        console.error(`Webhook ${webhook.id} delivery failed:`, error);
        await db.webhook
          .update({
            where: { id: webhook.id },
            data: { failureCount: { increment: 1 } },
          })
          .catch(() => undefined);
      } finally {
        clearTimeout(timeoutHandle);
        await db.webhookDelivery
          .create({
            data: {
              webhookId: webhook.id,
              event,
              url: webhook.url,
              statusCode: statusCode ?? null,
              ok,
              durationMs: Date.now() - startedAt,
              errorMessage,
            },
          })
          .catch(() => undefined);
      }
    })
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
    matching.map(async (webhook) => {
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
      } catch (error) {
        errorMessage = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      } finally {
        clearTimeout(timeoutHandle);
        await db.webhookDelivery
          .create({
            data: {
              webhookId: webhook.id,
              event,
              url: webhook.url,
              statusCode: statusCode ?? null,
              ok,
              durationMs: Date.now() - startedAt,
              errorMessage,
            },
          })
          .catch(() => undefined);
      }
    }),
  );
}
