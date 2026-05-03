import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  db: { ocrJob: { groupBy: vi.fn() } },
}));

vi.mock("@/lib/background/metrics", () => ({
  formatPrometheus: () => "# counters\n",
  getCounters: () => ({}),
}));

vi.mock("@/lib/ocr/job-control", () => ({
  getOcrQueueDepth: () => ({ active: 1, waiting: 2 }),
}));

import { db } from "@/lib/db";
import { GET } from "@/app/api/v1/metrics/route";

const mockedGroupBy = db.ocrJob.groupBy as ReturnType<typeof vi.fn>;

function makeReq(token?: string): NextRequest {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new NextRequest(new URL("http://localhost/api/v1/metrics"), { headers });
}

beforeEach(() => {
  mockedGroupBy.mockReset().mockResolvedValue([
    { status: "COMPLETED", _count: { _all: 5 } },
    { status: "FAILED", _count: { _all: 1 } },
  ]);
  process.env.METRICS_TOKEN = "secret-token";
});
afterEach(() => {
  vi.clearAllMocks();
  delete process.env.METRICS_TOKEN;
});

describe("GET /api/v1/metrics", () => {
  it("returns 503 when METRICS_TOKEN is not configured", async () => {
    delete process.env.METRICS_TOKEN;
    const res = await GET(makeReq("anything"));
    expect(res.status).toBe(503);
  });

  it("returns 401 when no bearer token is presented", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 401 when the bearer token does not match", async () => {
    const res = await GET(makeReq("wrong-token"));
    expect(res.status).toBe(401);
  });

  it("returns 200 with Prometheus body when token matches", async () => {
    const res = await GET(makeReq("secret-token"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("extracto_jobs_total{status=\"COMPLETED\"} 5");
    expect(body).toContain("extracto_queue_active 1");
    expect(body).toContain("extracto_queue_waiting 2");
  });
});
