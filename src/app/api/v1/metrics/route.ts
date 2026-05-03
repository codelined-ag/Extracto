import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { formatPrometheus, getCounters } from "@/lib/background/metrics";
import { getOcrQueueDepth } from "@/lib/ocr/job-control";

function getMetricsToken(): string {
  return process.env.METRICS_TOKEN?.trim() || "";
}

function timingSafeEqual(presented: string, expected: string): boolean {
  // Hash both sides to a fixed 32-byte digest so the constant-time compare
  // never short-circuits on length mismatch (which would leak the expected
  // token's length).
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return cryptoTimingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const expected = getMetricsToken();
  if (!expected) {
    return new Response("METRICS_TOKEN is not configured", { status: 503 });
  }
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !timingSafeEqual(match[1].trim(), expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const [statusCounts] = await Promise.all([
      db.ocrJob.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const queue = getOcrQueueDepth();

    const lines: string[] = [];
    lines.push("# TYPE extracto_jobs_total gauge");
    for (const row of statusCounts) {
      lines.push(`extracto_jobs_total{status="${row.status}"} ${row._count._all}`);
    }
    lines.push("# TYPE extracto_queue_active gauge");
    lines.push(`extracto_queue_active ${queue.active}`);
    lines.push("# TYPE extracto_queue_waiting gauge");
    lines.push(`extracto_queue_waiting ${queue.waiting}`);

    const counterPart = formatPrometheus(getCounters());
    const body = lines.join("\n") + "\n" + counterPart;
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  } catch (error) {
    console.error("metrics route failure:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
