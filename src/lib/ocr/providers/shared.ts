// Shared building blocks for the per-provider OCR runners (Ollama, Mistral,
// OpenRouter, OpenAI-compat). These were inlined in src/app/api/ocr/route.ts;
// extracting them here lets each provider live in its own module and lets the
// runners be exercised in unit tests with mocked fetch.

import { ApiRouteError } from "@/lib/api-error";
import { coerceMarkdownText } from "@/lib/ocr/markdown-routing";

export const REQUEST_TIMEOUT_MS = 60_000;

export interface OcrPage {
  index?: number;
  markdown?: string;
  text?: string;
  html?: string;
}

export type OcrRunResult = {
  text: string;
  structured: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type PostProcessResult = {
  text: string;
  metadata: Record<string, unknown>;
};

/**
 * Thrown by fetchWithTimeout when an externally-supplied AbortSignal fires.
 * Distinguishes user-requested cancellation from request timeouts so callers
 * can re-throw without translating to a 504.
 */
export class OcrStopRequestedError extends Error {
  constructor(message = "OCR stop requested") {
    super(message);
    this.name = "OcrStopRequestedError";
  }
}

/**
 * fetch() wrapper that adds:
 *  - a hard timeout (default REQUEST_TIMEOUT_MS) → ApiRouteError(504)
 *  - propagation of an external AbortSignal → OcrStopRequestedError
 * The two abort sources are tracked separately so we can throw the right error
 * shape per source.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let abortedByExternalSignal = false;
  let timeoutTriggered = false;
  const onExternalAbort = () => {
    abortedByExternalSignal = true;
    controller.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortedByExternalSignal = true;
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (abortedByExternalSignal) {
      throw new OcrStopRequestedError();
    }

    if (
      timeoutTriggered &&
      error instanceof Error &&
      (error.name === "AbortError" || /abort/iu.test(error.message))
    ) {
      throw new ApiRouteError(`Request timeout after ${timeoutMs}ms`, 504);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

/** Read a Response body as text and try to parse JSON; returns {} for empty bodies and {message:text} for non-JSON. */
export async function parseResponseText(response: Response): Promise<unknown> {
  const rawText = await response.text();
  if (!rawText.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawText);
  } catch {
    return { message: rawText };
  }
}

/**
 * OpenAI / Ollama chat-style content can be a string OR an array of typed
 * parts (e.g. [{type:"text",text:"…"}, {type:"image_url",…}]). Pull out the
 * text fragments and concatenate them.
 */
export function extractChatContentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }

        if (!entry || typeof entry !== "object") {
          return "";
        }

        const typedEntry = entry as { type?: unknown; text?: unknown };
        if (typedEntry.type === "text" && typeof typedEntry.text === "string") {
          return typedEntry.text.trim();
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

/**
 * Provider-agnostic shape coercion for OCR responses: the model is expected to
 * return JSON of shape { markdown, fields }, but it sometimes returns raw
 * markdown. This helper normalizes both cases into a consistent
 * { markdown, structured, parseMode } shape.
 */
export function normalizeStructuredMarkdownPayload(
  raw: unknown,
  fallbackMarkdown: string,
): {
  markdown: string;
  structured: Record<string, unknown>;
  parseMode: "json" | "markdown";
} {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const objectValue = raw as Record<string, unknown>;
    const markdown = coerceMarkdownText(
      objectValue.markdown ?? objectValue.text ?? objectValue.content,
      fallbackMarkdown,
    );

    return {
      markdown,
      structured: {
        ...objectValue,
        markdown,
      },
      parseMode: "json",
    };
  }

  const markdown = fallbackMarkdown.trim();
  return {
    markdown,
    structured: {
      markdown,
    },
    parseMode: "markdown",
  };
}
