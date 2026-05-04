import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/lib/db", () => ({
  db: {
    ocrJob: { findUnique: vi.fn() },
    webhook: { findMany: vi.fn(), update: vi.fn() },
    webhookDelivery: { create: vi.fn().mockResolvedValue({}) },
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
import { resolveAndCheckExternalUrl } from "@/lib/url-safety";
import {
  dispatchJobWebhooks,
  serializeEventList,
  verifyWebhookSignature,
} from "@/lib/background/webhooks";

const mFindJob = db.ocrJob.findUnique as ReturnType<typeof vi.fn>;
const mFindWebhooks = db.webhook.findMany as ReturnType<typeof vi.fn>;
const mUpdateWebhook = db.webhook.update as ReturnType<typeof vi.fn>;
const mResolveUrl = resolveAndCheckExternalUrl as ReturnType<typeof vi.fn>;

const realFetch = global.fetch;
let mockedFetch: ReturnType<typeof vi.fn>;

const SECRET = "whsec_integration_test_secret_with_enough_length";

const baseJob = {
  id: "job-1",
  status: "COMPLETED" as const,
  fileName: "doc.pdf",
  model: "ollama:llama3.2",
  errorMessage: null,
  completedAt: new Date("2026-05-03T12:00:00Z"),
  createdAt: new Date("2026-05-03T11:59:00Z"),
  processingMs: 1234,
  apiKeyId: null,
  batchId: null,
  userId: "user-1",
};

beforeEach(() => {
  mockedFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  global.fetch = mockedFetch as unknown as typeof fetch;
  mFindJob.mockReset().mockResolvedValue(baseJob);
  mFindWebhooks.mockReset().mockResolvedValue([]);
  mUpdateWebhook.mockReset().mockResolvedValue({});
  mResolveUrl.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("dispatchJobWebhooks integration", () => {
  it("does nothing when the job is missing", async () => {
    mFindJob.mockResolvedValueOnce(null);
    await dispatchJobWebhooks("missing", "job.completed");
    expect(mFindWebhooks).not.toHaveBeenCalled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("does nothing when the job has no userId", async () => {
    mFindJob.mockResolvedValueOnce({ ...baseJob, userId: null });
    await dispatchJobWebhooks("job-1", "job.completed");
    expect(mFindWebhooks).not.toHaveBeenCalled();
  });

  it("does not deliver to webhooks not subscribed to the event", async () => {
    mFindWebhooks.mockResolvedValueOnce([
      {
        id: "wh-1",
        url: "https://example.test/hook",
        secret: SECRET,
        events: serializeEventList(["job.failed"]),
      },
    ]);
    await dispatchJobWebhooks("job-1", "job.completed");
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("delivers to subscribed webhooks with a verifiable signature header", async () => {
    mFindWebhooks.mockResolvedValueOnce([
      {
        id: "wh-1",
        url: "https://example.test/hook",
        secret: SECRET,
        events: serializeEventList(["job.completed"]),
      },
    ]);
    await dispatchJobWebhooks("job-1", "job.completed");

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/hook");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Extracto-Event"]).toBe("job.completed");
    expect(headers["X-Extracto-Signature"]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

    const body = init.body as string;
    const payload = JSON.parse(body) as { event: string; job: { id: string; fileName: string } };
    expect(payload.event).toBe("job.completed");
    expect(payload.job.id).toBe("job-1");
    expect(payload.job.fileName).toBe("doc.pdf");

    expect(
      verifyWebhookSignature(SECRET, body, headers["X-Extracto-Signature"]),
    ).toBe(true);

    expect(mUpdateWebhook).toHaveBeenCalledWith({
      where: { id: "wh-1" },
      data: { lastFiredAt: expect.any(Date), failureCount: 0 },
    });
  });

  it("increments failureCount when the URL safety check rejects the target", async () => {
    mFindWebhooks.mockResolvedValueOnce([
      {
        id: "wh-private",
        url: "http://10.0.0.1/hook",
        secret: SECRET,
        events: serializeEventList(["job.completed"]),
      },
    ]);
    mResolveUrl.mockResolvedValueOnce({ ok: false, reason: "private address" });

    await dispatchJobWebhooks("job-1", "job.completed");

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mUpdateWebhook).toHaveBeenCalledWith({
      where: { id: "wh-private" },
      data: { failureCount: { increment: 1 } },
    });
  });

  it("increments failureCount when the remote returns a non-2xx status", async () => {
    mFindWebhooks.mockResolvedValueOnce([
      {
        id: "wh-fail",
        url: "https://example.test/hook",
        secret: SECRET,
        events: serializeEventList(["job.completed"]),
      },
    ]);
    mockedFetch.mockResolvedValueOnce(new Response("nope", { status: 503 }));

    await dispatchJobWebhooks("job-1", "job.completed");

    expect(mUpdateWebhook).toHaveBeenCalledWith({
      where: { id: "wh-fail" },
      data: { failureCount: { increment: 1 } },
    });
  });

  it("delivers to multiple matching webhooks in parallel with distinct signatures", async () => {
    mFindWebhooks.mockResolvedValueOnce([
      {
        id: "wh-a",
        url: "https://a.test/hook",
        secret: "whsec_secret_one_______________________________________",
        events: serializeEventList(["job.completed"]),
      },
      {
        id: "wh-b",
        url: "https://b.test/hook",
        secret: "whsec_secret_two_______________________________________",
        events: serializeEventList(["job.completed", "job.failed"]),
      },
    ]);

    await dispatchJobWebhooks("job-1", "job.completed");

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const calls = mockedFetch.mock.calls as Array<[string, RequestInit]>;
    const urls = calls.map(([u]) => u).sort();
    expect(urls).toEqual(["https://a.test/hook", "https://b.test/hook"]);
    const sigs = calls.map(([, init]) => (init.headers as Record<string, string>)["X-Extracto-Signature"]);
    expect(sigs[0]).not.toEqual(sigs[1]);
  });

  it("emits the v1 signature using sha256 of `${timestamp}.${body}`", async () => {
    mFindWebhooks.mockResolvedValueOnce([
      {
        id: "wh-1",
        url: "https://example.test/hook",
        secret: SECRET,
        events: serializeEventList(["job.failed"]),
      },
    ]);
    await dispatchJobWebhooks("job-1", "job.failed");

    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    const sigHeader = (init.headers as Record<string, string>)["X-Extracto-Signature"];
    const body = init.body as string;
    const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(sigHeader);
    expect(match).not.toBeNull();
    const ts = Number(match![1]);
    const expected = createHmac("sha256", SECRET).update(`${ts}.${body}`, "utf8").digest("hex");
    expect(match![2]).toBe(expected);
  });
});
