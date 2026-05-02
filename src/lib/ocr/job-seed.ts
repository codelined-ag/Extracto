// Pure seed helpers used by processOcrJobInBackground to initialize
// per-job state. Lifted out of src/app/api/ocr/route.ts so they can be
// unit-tested without spinning up the full pipeline.

import { appendPageMarkdown } from "@/lib/ocr/markdown-routing";
import type { ProviderKind } from "@/lib/api-types";
import type { PostProcessingSettings } from "@/lib/ocr/settings";

export interface SeedablePageOutput {
  pageNumber: number;
  text: string;
  structured: Record<string, unknown>;
  durationMs: number;
}

/**
 * Structural shape of the postProcessing block in OcrProgressMetadata.
 * Kept as a structural type here so the seed module doesn't depend on
 * the route file (which would create a cycle).
 */
export interface PostProcessingMetaSeed {
  enabled: boolean;
  outputFormat?: PostProcessingSettings["outputFormat"];
  instruction?: PostProcessingSettings["instruction"];
  model?: string;
}

/**
 * Replay the page-markdown accumulator over an array of already-completed
 * pages. Used to seed extractedTextSoFar / extractedChunkCount when an OCR
 * job resumes from a checkpoint.
 */
export function seedExtractedText(
  pageOutputs: SeedablePageOutput[],
): { text: string; chunks: number } {
  let text = "";
  let chunks = 0;
  for (const page of pageOutputs) {
    ({ text, chunks } = appendPageMarkdown(text, chunks, page));
  }
  return { text, chunks };
}

/**
 * Build the initial set of Ollama models that need unloading at job-end.
 * Only the OCR model is preloaded at startup; the post-processing model
 * (if Ollama-routed) is added later inside the run loop.
 */
export function seedUsedOllamaModels(provider: ProviderKind, ocrModel: string): Set<string> {
  const set = new Set<string>();
  if (provider === "ollama") set.add(ocrModel);
  return set;
}

/**
 * Build the initial postProcessing metadata block written to
 * OcrJob.metadata. When post-processing is disabled, only `enabled:
 * false` is set; when enabled, the model/format/instruction are
 * pre-populated for the UI to show before the post-process step
 * actually runs.
 */
export function seedPostProcessingMeta(
  payload: PostProcessingSettings,
  postProcessingModel: string,
): PostProcessingMetaSeed {
  return {
    enabled: payload.enabled,
    ...(payload.enabled
      ? {
          outputFormat: payload.outputFormat,
          instruction: payload.instruction,
          model: postProcessingModel,
        }
      : {}),
  };
}
