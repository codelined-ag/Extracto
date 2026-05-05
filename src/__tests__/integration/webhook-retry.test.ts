import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    webhook: { update: vi.fn().mockResolvedValue({ active: true, failureCount: 1 }) },
    webhookDelivery: {
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/url-safety", async () => {
  const actual = await vi.importActual<typeof import("@/lib/url-safety")>("@/lib/url-safety");
  return {
    ...actual,
    resolveAndCheckExternalUrl: vi.fn().mockResolvedValue({ ok: true }),
  };
});

import { db } from "@/lib/db";
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_BACKOFF_SECONDS,
  sweepDueWebhookRetries,
} from "@/lib/background/webhooks";

const mFindDeliveries = db.webhookDelivery.findMany as ReturnType<typeof vi.fn>;
const mUpdateDelivery = db.webhookDelivery.update as ReturnType<typeof vi.fn>;

const realFetch = global.fetch;
let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  global.fetch = mockedFetch as unknown as typeof fetch;
  mFindDeliveries.mockReset().mockResolvedValue([]);
  mUpdateDelivery.mockReset().mockResolvedValue({});
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("sweepDueWebhookRetries", () => {
  it("retries pending deliveries that are due and flips them to delivered on success", async () => {
    mFindDeliveries.mockResolvedValueOnce([
      {
        id: "del-1",
        event: "job.completed",
        body: JSON.stringify({ event: "job.completed" }),
        attempt: 1,
        webhook: { id: "wh-1", url: "https://example.test/hook", secret: "whsec_x".padEnd(40, "x"), active: true },
      },
    ]);

    const result = await sweepDueWebhookRetries();

    expect(result.retried).toBe(1);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const updateCall = mUpdateDelivery.mock.calls.find((call) => call[0].where.id === "del-1");
    expect(updateCall).toBeDefined();
    expect(updateCall![0].data.status).toBe("delivered");
    expect(updateCall![0].data.nextRetryAt).toBeNull();
    expect(updateCall![0].data.attempt).toBe(2);
  });

  it("schedules another retry with backoff when delivery still fails and attempts remain", async () => {
    mockedFetch.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    mFindDeliveries.mockResolvedValueOnce([
      {
        id: "del-2",
        event: "job.completed",
        body: JSON.stringify({ event: "job.completed" }),
        attempt: 1,
        webhook: { id: "wh-2", url: "https://example.test/hook", secret: "whsec_x".padEnd(40, "x"), active: true },
      },
    ]);

    await sweepDueWebhookRetries();

    const updateCall = mUpdateDelivery.mock.calls.find((call) => call[0].where.id === "del-2");
    expect(updateCall).toBeDefined();
    expect(updateCall![0].data.status).toBe("pending");
    expect(updateCall![0].data.attempt).toBe(2);
    const eta = updateCall![0].data.nextRetryAt as Date;
    expect(eta).toBeInstanceOf(Date);
    const delaySeconds = (eta.getTime() - Date.now()) / 1000;
    expect(delaySeconds).toBeGreaterThan(WEBHOOK_RETRY_BACKOFF_SECONDS[1] - 5);
    expect(delaySeconds).toBeLessThan(WEBHOOK_RETRY_BACKOFF_SECONDS[1] + 5);
  });

  it("marks delivery exhausted once max attempts hits", async () => {
    mockedFetch.mockResolvedValueOnce(new Response("nope", { status: 503 }));
    const finalAttempt = WEBHOOK_MAX_ATTEMPTS - 1;
    mFindDeliveries.mockResolvedValueOnce([
      {
        id: "del-3",
        event: "job.completed",
        body: JSON.stringify({ event: "job.completed" }),
        attempt: finalAttempt,
        webhook: { id: "wh-3", url: "https://example.test/hook", secret: "whsec_x".padEnd(40, "x"), active: true },
      },
    ]);

    await sweepDueWebhookRetries();

    const updateCall = mUpdateDelivery.mock.calls.find((call) => call[0].where.id === "del-3");
    expect(updateCall).toBeDefined();
    expect(updateCall![0].data.status).toBe("exhausted");
    expect(updateCall![0].data.nextRetryAt).toBeNull();
  });

  it("skips inactive webhooks and exhausts their queued retries", async () => {
    mFindDeliveries.mockResolvedValueOnce([
      {
        id: "del-4",
        event: "job.completed",
        body: "{}",
        attempt: 1,
        webhook: { id: "wh-4", url: "https://example.test/hook", secret: "x", active: false },
      },
    ]);

    await sweepDueWebhookRetries();

    expect(mockedFetch).not.toHaveBeenCalled();
    const updateCall = mUpdateDelivery.mock.calls.find((call) => call[0].where.id === "del-4");
    expect(updateCall![0].data).toEqual({ status: "exhausted", nextRetryAt: null });
  });

  it("exhausts deliveries with a missing body payload", async () => {
    mFindDeliveries.mockResolvedValueOnce([
      {
        id: "del-5",
        event: "job.completed",
        body: null,
        attempt: 1,
        webhook: { id: "wh-5", url: "https://example.test/hook", secret: "x", active: true },
      },
    ]);

    await sweepDueWebhookRetries();

    expect(mockedFetch).not.toHaveBeenCalled();
    const updateCall = mUpdateDelivery.mock.calls.find((call) => call[0].where.id === "del-5");
    expect(updateCall![0].data).toEqual({ status: "exhausted", nextRetryAt: null });
  });

  it("does nothing when there are no due deliveries", async () => {
    const result = await sweepDueWebhookRetries();
    expect(result.retried).toBe(0);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
