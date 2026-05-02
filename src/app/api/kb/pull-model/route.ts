import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, parseJsonBody } from "@/lib/api-error";
import { withMutationAuth } from "@/lib/auth/request";
import { getKbDefaults } from "@/lib/kb/defaults-store";

interface PullRequest extends Record<string, unknown> {
  model?: unknown;
  apiEndpoint?: unknown;
}

const PULL_TIMEOUT_MS = 5 * 60 * 1000;

function trimSlashes(s: string): string {
  return s.replace(/\/+$/u, "");
}

export const POST = withMutationAuth("settings:write", async (request: NextRequest, { auth }) => {
  const body = await parseJsonBody<PullRequest>(request);
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) throw new ApiRouteError("model is required", 400);

  const defaults = await getKbDefaults(auth.userId);
  const endpoint = (typeof body.apiEndpoint === "string" && body.apiEndpoint.trim())
    ? body.apiEndpoint.trim()
    : defaults.embedding.apiEndpoint;

  const url = `${trimSlashes(endpoint)}/api/pull`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new ApiRouteError(`Ollama pull ${resp.status}: ${text.slice(0, 400) || resp.statusText}`, 502);
    }
    return NextResponse.json({ ok: true, model });
  } catch (err) {
    if (err instanceof ApiRouteError) throw err;
    const message = err instanceof Error ? err.message : "Pull failed";
    throw new ApiRouteError(message, 502);
  } finally {
    clearTimeout(timer);
  }
});
