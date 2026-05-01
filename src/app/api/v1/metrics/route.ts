import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { formatPrometheus, getCounters } from "@/lib/metrics";
import { getOcrQueueDepth } from "@/lib/ocr/job-control";

const METRICS_TOKEN = process.env.METRICS_TOKEN?.trim() || "";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  if (!METRICS_TOKEN) {
    return new Response("METRICS_TOKEN is not configured", { status: 503 });
  }
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !timingSafeEqual(match[1].trim(), METRICS_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const [statusCounts, queue] = await Promise.all([
    db.ocrJob.groupBy({ by: ["status"], _count: { _all: true } }),
    Promise.resolve(getOcrQueueDepth()),
  ]);

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
}
