// Ollama OCR + post-processing runner.
//
// Contract: callers pass already-resolved + already-policy-checked host base
// URLs (e.g. "http://host.docker.internal:11434"). This module does NOT do
// host candidate generation, network-mode rewriting, or endpoint policy
// enforcement — those concerns belong to the route handler so that this
// module can be unit-tested with synthetic hosts and a mocked global.fetch.

import { ApiRouteError, errorMessage } from "@/lib/api-error";
import { parseServiceError, parsePreviewImageData } from "@/lib/ocr/error-parsing";
import { parseJsonCandidate } from "@/lib/ocr/markdown-routing";
import {
  extractChatContentText,
  fetchWithTimeout,
  normalizeStructuredMarkdownPayload,
  OcrStopRequestedError,
  parseResponseText,
  REQUEST_TIMEOUT_MS,
  type OcrRunResult,
  type PostProcessResult,
} from "@/lib/ocr/providers/shared";

const CHAT_ENDPOINTS = ["/api/chat", "/v1/chat/completions"] as const;

export async function runOllamaOcr(
  hostBases: string[],
  model: string,
  prompt: string,
  preview: string,
  signal?: AbortSignal,
): Promise<OcrRunResult> {
  const imageData = parsePreviewImageData(preview);
  if (!imageData.base64) {
    throw new ApiRouteError("Invalid image data for Ollama OCR", 400);
  }

  const errors: string[] = [];

  for (const host of hostBases) {
    for (const chatPath of CHAT_ENDPOINTS) {
      try {
        const response = await fetchWithTimeout(
          `${host}${chatPath}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(
              chatPath === "/api/chat"
                ? {
                    model,
                    messages: [
                      {
                        role: "user",
                        content: prompt,
                        images: [imageData.base64],
                      },
                    ],
                    stream: false,
                  }
                : {
                    model,
                    messages: [
                      {
                        role: "user",
                        content: [
                          { type: "text", text: prompt },
                          {
                            type: "image_url",
                            image_url: { url: imageData.dataUrl },
                          },
                        ],
                      },
                    ],
                    temperature: 0,
                    stream: false,
                  },
            ),
          },
          REQUEST_TIMEOUT_MS,
          signal,
        );

        const payload = await parseResponseText(response);
        if (!response.ok) {
          errors.push(
            `${host}${chatPath}: ${response.status} ${parseServiceError(response, payload)}`,
          );
          continue;
        }

        if (!payload || typeof payload !== "object") {
          errors.push(`${host}${chatPath}: invalid OCR response payload`);
          continue;
        }

        const openAiChoices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
        const message = chatPath === "/api/chat"
          ? (payload as { message?: { content?: unknown } }).message
          : Array.isArray(openAiChoices)
            ? openAiChoices[0]?.message
            : undefined;
        const payloadWithMetrics = payload as {
          done?: unknown;
          eval_count?: unknown;
          total_duration?: unknown;
        };

        const text = extractChatContentText(message?.content);
        if (!text) {
          errors.push(`${host}${chatPath}: OCR response had no text`);
          continue;
        }

        const parsedPayload = parseJsonCandidate(text);
        const normalizedPayload = normalizeStructuredMarkdownPayload(parsedPayload, text);
        if (!normalizedPayload.markdown) {
          errors.push(`${host}${chatPath}: OCR response markdown was empty`);
          continue;
        }

        return {
          text: normalizedPayload.markdown,
          structured: normalizedPayload.structured,
          metadata: {
            responseDone: typeof payloadWithMetrics.done === "boolean" ? payloadWithMetrics.done : undefined,
            evalCount:
              typeof payloadWithMetrics.eval_count === "number"
                ? payloadWithMetrics.eval_count
                : undefined,
            totalDurationMs:
              typeof payloadWithMetrics.total_duration === "number"
                ? payloadWithMetrics.total_duration
                : undefined,
            outputFormat: normalizedPayload.parseMode,
          },
        };
      } catch (error) {
        if (error instanceof OcrStopRequestedError) {
          throw error;
        }
        errors.push(
          `${host}${chatPath}: ${errorMessage(error, "Request failed")}`,
        );
      }
    }
  }

  // No success across any host × chat-path. Caller is responsible for adding
  // a network hint and any reachability diagnostics; we just surface the raw
  // error list so the failure mode stays inspectable.
  throw new ApiRouteError(`Ollama OCR failed on all hosts: ${errors.join(" | ")}`, 502);
}

export async function runOllamaPostProcessing(
  hostBases: string[],
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<PostProcessResult> {
  const errors: string[] = [];

  for (const host of hostBases) {
    for (const chatPath of CHAT_ENDPOINTS) {
      try {
        const response = await fetchWithTimeout(`${host}${chatPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: false,
            temperature: 0,
          }),
        });

        const payload = await parseResponseText(response);
        if (!response.ok) {
          errors.push(
            `${host}${chatPath}: ${response.status} ${parseServiceError(response, payload)}`,
          );
          continue;
        }

        if (!payload || typeof payload !== "object") {
          errors.push(`${host}${chatPath}: invalid post-processing response payload`);
          continue;
        }

        const openAiChoices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
        const message = chatPath === "/api/chat"
          ? (payload as { message?: { content?: unknown } }).message
          : Array.isArray(openAiChoices)
            ? openAiChoices[0]?.message
            : undefined;
        const text = extractChatContentText(message?.content);
        if (!text) {
          errors.push(`${host}${chatPath}: post-processing response had no text`);
          continue;
        }

        return {
          text,
          metadata: {
            endpoint: `${host}${chatPath}`,
          },
        };
      } catch (error) {
        errors.push(
          `${host}${chatPath}: ${errorMessage(error, "Request failed")}`,
        );
      }
    }
  }

  throw new ApiRouteError(`Post-processing failed on Ollama: ${errors.join(" | ")}`, 502);
}

/**
 * Best-effort: ask Ollama to drop a model from memory (keep_alive=0 on the
 * generate endpoint). Failures are silent — used during job teardown so a
 * bad host shouldn't fail the whole job.
 */
export async function unloadOllamaModel(hostBases: string[], model: string): Promise<void> {
  for (const host of hostBases) {
    try {
      await fetchWithTimeout(
        `${host}/api/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            prompt: "",
            stream: false,
            keep_alive: 0,
          }),
        },
        10_000,
      );
      return;
    } catch {
      // try next host candidate
    }
  }
}

/**
 * Best-effort: pre-load a model into VRAM with a 1-token generation so the
 * first user request doesn't pay cold-start cost. Errors swallowed.
 */
export async function warmupOllamaModel(hostBases: string[], model: string): Promise<void> {
  for (const host of hostBases) {
    try {
      await fetchWithTimeout(
        `${host}/api/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            prompt: "Warmup",
            stream: false,
            options: { num_predict: 1 },
            keep_alive: "10m",
          }),
        },
        15_000,
      );
      return;
    } catch {
      // try next host candidate
    }
  }
}
