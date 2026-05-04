import { NextRequest } from "next/server";

import { authenticateRequest } from "@/lib/auth/request";
import { getS3Export, subscribeS3Export, type S3ExportProgressEvent } from "@/lib/s3/export-progress";

export const dynamic = "force-dynamic";

const MAX_LIFETIME_MS = 15 * 60 * 1000;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ exportId: string }> },
) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { exportId } = await context.params;
  const initial = getS3Export(exportId, auth.userId);
  if (!initial) {
    return new Response(JSON.stringify({ error: "Export not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: S3ExportProgressEvent) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* controller closed */ }
      };

      send("progress", initial);
      if (initial.phase === "done" || initial.phase === "error") {
        cancelled = true;
        queueMicrotask(() => { try { controller.close(); } catch { /* already closed */ } });
        return;
      }

      const unsubscribe = subscribeS3Export(exportId, auth.userId, (event) => {
        send("progress", event);
        if (event.phase === "done" || event.phase === "error") {
          cancelled = true;
          if (typeof unsubscribe === "function") unsubscribe();
          queueMicrotask(() => { try { controller.close(); } catch { /* already closed */ } });
        }
      });

      const lifetimeTimer = setInterval(() => {
        if (cancelled) { clearInterval(lifetimeTimer); return; }
        if (Date.now() - startedAt > MAX_LIFETIME_MS) {
          cancelled = true;
          if (typeof unsubscribe === "function") unsubscribe();
          clearInterval(lifetimeTimer);
          queueMicrotask(() => { try { controller.close(); } catch { /* already closed */ } });
        }
      }, 30_000);

      request.signal.addEventListener("abort", () => {
        cancelled = true;
        if (typeof unsubscribe === "function") unsubscribe();
        clearInterval(lifetimeTimer);
        queueMicrotask(() => { try { controller.close(); } catch { /* already closed */ } });
      });
    },
    cancel() { cancelled = true; },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
