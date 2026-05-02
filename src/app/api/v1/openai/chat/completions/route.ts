import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { OcrJobStatus } from "@prisma/client";

import { errorMessage } from "@/lib/api-error";
import { authenticateMutation, authHasScope } from "@/lib/auth/request";
import { db } from "@/lib/db";
import { normalizeProvider } from "@/lib/endpoint-policy";
import {
  buildPrompt,
  resolveProvider,
  sanitizePostProcessing,
  submitOcrJob,
} from "@/lib/ocr/pipeline";
import { resolveMistralOcrModel } from "@/lib/ocr/providers/mistral";
import { normalizeAdvancedSettings } from "@/lib/ocr/settings";
import { readResultText } from "@/lib/result-store";
import { getApiSettings } from "@/lib/settings-store";

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

const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 5 * 60 * 1000;

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

export async function POST(request: NextRequest) {
  try {
  const result = await authenticateMutation(request);
  if (!result.ok) {
    return NextResponse.json({ error: { message: result.error, type: "auth_error" } }, { status: result.status });
  }
  if (!authHasScope(result.auth, "ocr:submit")) {
    // OpenAI-compatible error envelope — cannot use requireScope() which returns plain { error: string }
    return NextResponse.json(
      { error: { message: "Missing required scope: ocr:submit", type: "permission_error" } },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as OpenAIChatRequest | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return NextResponse.json(
      { error: { message: "model is required", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const { preview, prompt } = pickImageAndPrompt(body.messages);
  if (!preview) {
    return NextResponse.json(
      {
        error: {
          message:
            "messages must contain at least one image_url part (this adapter performs OCR; text-only requests are not supported)",
          type: "invalid_request_error",
        },
      },
      { status: 400 }
    );
  }

  // Submit directly via the pipeline helper (no HTTP-loopback to /api/ocr).
  const storedSettings = await getApiSettings(result.auth.userId);
  const settings = { ...storedSettings, provider: normalizeProvider(storedSettings.provider) };
  const settingsPayload = normalizeAdvancedSettings(undefined);
  const postProcessingPayload = sanitizePostProcessing(
    prompt ? { enabled: true, instruction: prompt, outputFormat: "markdown" } : undefined,
  );
  const provider = resolveProvider(settings);
  const ocrModel = provider === "mistral" ? resolveMistralOcrModel(model) : model;
  const ocrPrompt = buildPrompt(settingsPayload);

  let jobId: string;
  try {
    const created = await submitOcrJob({
      userId: result.auth.userId,
      apiKeyId: result.auth.method === "api-key" ? result.auth.apiKeyId ?? null : null,
      fileName: "openai-adapter",
      model,
      ocrModel,
      provider,
      settings,
      settingsPayload,
      postProcessingPayload,
      inputPreviews: [preview],
      prompt: ocrPrompt,
      sourcePreview: null,
    });
    jobId = created.jobId;
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: errorMessage(error, "OCR submission failed"),
          type: "upstream_error",
        },
      },
      { status: 502 },
    );
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const job = await db.ocrJob.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        extractedText: true,
        extractedTextLocation: true,
        errorMessage: true,
      },
    });
    if (!job) break;
    if (job.status === OcrJobStatus.COMPLETED) {
      const text = await readResultText(job.extractedTextLocation, job.extractedText);
      return NextResponse.json({
        id: `chatcmpl-${randomBytes(8).toString("hex")}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text || "" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        extracto: { jobId },
      });
    }
    if (job.status === OcrJobStatus.FAILED) {
      return NextResponse.json(
        {
          error: {
            message: job.errorMessage || "OCR job failed",
            type: "upstream_error",
          },
          extracto: { jobId },
        },
        { status: 502 }
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return NextResponse.json(
    {
      error: {
        message: "Timed out waiting for OCR completion",
        type: "timeout_error",
      },
      extracto: { jobId },
    },
    { status: 504 }
  );
  } catch (error) {
    // Wrap in OpenAI's nested-error envelope so the entire route surface
    // (success + every failure path) speaks the same shape.
    const message = errorMessage(error, "Internal server error");
    const status = error instanceof Error && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;
    return NextResponse.json(
      { error: { message, type: "internal_error" } },
      { status },
    );
  }
}
