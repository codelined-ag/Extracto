import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { ApiRouteError, errorMessage } from "@/lib/api-error";
import { authenticateMutation, authHasScope } from "@/lib/auth/request";
import { enforceOcrSubmitRateLimit } from "@/lib/ocr/rate-limit";
import { getClientIpAddress } from "@/lib/request-security";
import { resolveOcrJobInputs } from "@/lib/ocr/job-submit-prep";
import { waitForOcrJobCompletion } from "@/lib/ocr/job-wait";
import { submitOcrJob } from "@/lib/ocr/pipeline";

interface OpenAIChatRequest {
  model?: unknown;
  messages?: unknown;
  max_tokens?: unknown;
  temperature?: unknown;
}

interface ContentPart {
  type?: unknown;
  text?: unknown;
  image_url?: unknown;
}

function extractImagePartUrl(part: ContentPart): string | null {
  if (!part || typeof part !== "object") return null;
  if (part.type !== "image_url") return null;
  const imageUrl = part.image_url;
  if (typeof imageUrl === "string") return imageUrl;
  if (imageUrl && typeof imageUrl === "object") {
    const url = (imageUrl as { url?: unknown }).url;
    if (typeof url === "string") return url;
  }
  return null;
}

function extractTextPart(part: ContentPart): string {
  if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
    return part.text;
  }
  return "";
}

function pickImageAndPrompt(messages: unknown): { preview: string | null; prompt: string } {
  if (!Array.isArray(messages)) return { preview: null, prompt: "" };
  let preview: string | null = null;
  const promptParts: string[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const content = (msg as { content?: unknown }).content;
    if (typeof content === "string") {
      promptParts.push(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        const text = extractTextPart(part);
        if (text) promptParts.push(text);
        if (!preview) {
          const url = extractImagePartUrl(part);
          if (url) preview = url;
        }
      }
    }
  }
  return { preview, prompt: promptParts.join("\n\n") };
}

function openAiError(message: string, type: string, status: number): NextResponse {
  return NextResponse.json({ error: { message, type } }, { status });
}

export async function POST(request: NextRequest) {
  try {
  const result = await authenticateMutation(request);
  if (!result.ok) {
    return openAiError(result.error, "authentication_error", result.status);
  }
  if (!authHasScope(result.auth, "ocr:submit")) {
    return openAiError("Missing required scope: ocr:submit", "permission_error", 403);
  }
  const limited = enforceOcrSubmitRateLimit(result.auth, getClientIpAddress(request));
  if (limited) {
    const retryAfter = limited.headers.get("Retry-After");
    const body = JSON.stringify({
      error: { message: "Too many OCR jobs requested. Please retry shortly.", type: "rate_limit_error" },
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (retryAfter) headers["Retry-After"] = retryAfter;
    return new NextResponse(body, { status: 429, headers });
  }

  const body = (await request.json().catch(() => null)) as OpenAIChatRequest | null;
  if (!body || typeof body !== "object") {
    return openAiError("Invalid JSON body", "invalid_request_error", 400);
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return openAiError("model is required", "invalid_request_error", 400);
  }

  const { preview, prompt } = pickImageAndPrompt(body.messages);
  if (!preview) {
    return openAiError(
      "messages must contain at least one image_url part (this adapter performs OCR; text-only requests are not supported)",
      "invalid_request_error",
      400,
    );
  }

  // Submit directly via the pipeline helper (no HTTP-loopback to /api/ocr).
  const inputs = await resolveOcrJobInputs({
    userId: result.auth.userId,
    model,
    perRequestPostProcessing: prompt
      ? { enabled: true, instruction: prompt, outputFormat: "markdown" }
      : undefined,
  });

  let jobId: string;
  try {
    const created = await submitOcrJob({
      ...inputs,
      userId: result.auth.userId,
      apiKeyId: result.auth.method === "api-key" ? result.auth.apiKeyId ?? null : null,
      fileName: "openai-adapter",
      model,
      inputPreviews: [preview],
      sourcePreview: null,
    });
    jobId = created.jobId;
  } catch (error) {
    return openAiError(errorMessage(error, "OCR submission failed"), "api_error", 502);
  }
  const outcome = await waitForOcrJobCompletion({ jobId });
  if (outcome.kind === "completed") {
    return NextResponse.json({
      id: `chatcmpl-${randomBytes(8).toString("hex")}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: outcome.text },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      extracto: { jobId },
    });
  }
  if (outcome.kind === "failed" || outcome.kind === "missing") {
    const message = outcome.kind === "failed" ? outcome.errorMessage : "OCR job not found";
    return NextResponse.json(
      { error: { message, type: "api_error" }, extracto: { jobId } },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { error: { message: "Timed out waiting for OCR completion", type: "api_error" }, extracto: { jobId } },
    { status: 504 },
  );
  } catch (error) {
    const message = errorMessage(error, "Internal server error");
    const status = error instanceof ApiRouteError ? error.status : 500;
    return openAiError(message, openAiErrorTypeFromStatus(status), status);
  }
}

function openAiErrorTypeFromStatus(status: number): string {
  if (status === 400) return "invalid_request_error";
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "invalid_request_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 400 && status < 500) return "invalid_request_error";
  return "api_error";
}
