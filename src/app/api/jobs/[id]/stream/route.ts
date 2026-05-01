import { NextRequest } from "next/server";

import { authenticateRequest, requireScope } from "@/lib/auth/request";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 800;
const MAX_LIFETIME_MS = 30 * 60 * 1000;

type TerminalStatus = "COMPLETED" | "FAILED";
const TERMINAL_STATUSES: TerminalStatus[] = ["COMPLETED", "FAILED"];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const scopeError = requireScope(auth, "ocr:read");
  if (scopeError) return scopeError;

  const { id } = await context.params;
  if (!id) {
    return new Response(JSON.stringify({ error: "Job id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userId = auth.userId;
  const initial = await db.ocrJob.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!initial) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const encoder = new TextEncoder();
  let lastUpdatedAt = 0;
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
          return true;
        } catch {
          cancelled = true;
          return false;
        }
      };

      send("hello", { jobId: id });

      while (!cancelled) {
        if (Date.now() - startedAt > MAX_LIFETIME_MS) {
          send("timeout", { jobId: id });
          break;
        }

        const job = await db.ocrJob
          .findFirst({
            where: { id, userId },
            select: {
              id: true,
              status: true,
              metadata: true,
              errorMessage: true,
              processingMs: true,
              completedAt: true,
              updatedAt: true,
            },
          })
          .catch(() => null);

        if (!job) {
          send("error", { error: "Job disappeared" });
          break;
        }

        const updatedAtMs = job.updatedAt.getTime();
        if (updatedAtMs > lastUpdatedAt) {
          lastUpdatedAt = updatedAtMs;
          send("progress", {
            id: job.id,
            status: job.status,
            metadata: job.metadata,
            errorMessage: job.errorMessage,
            processingMs: job.processingMs,
            completedAt: job.completedAt,
            updatedAt: job.updatedAt,
          });
        }

        if (TERMINAL_STATUSES.includes(job.status as TerminalStatus)) {
          send("done", { id: job.id, status: job.status });
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      try {
        controller.close();
      } catch {
        // already closed
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
