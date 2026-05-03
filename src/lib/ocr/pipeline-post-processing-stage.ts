import { errorMessage } from "@/lib/api-error";
import { db } from "@/lib/db";
import { normalizeProvider } from "@/lib/ocr/endpoint-policy";
import { ollamaWarmupWithResolvedHost } from "@/lib/ocr/ollama-dispatch";
import {
  appendProgressEvent,
  type OcrProgressMetadata,
  type ProgressSnapshotInput,
} from "@/lib/ocr/pipeline-progress";
import {
  buildPostProcessingPrompt,
  normalizePostProcessedText,
} from "@/lib/ocr/pipeline-post-processing";
import { toJsonValue } from "@/lib/ocr/pipeline-result-builder";
import { runProviderPostProcessing } from "@/lib/ocr/provider-dispatch";
import type { PostProcessingSettings } from "@/lib/ocr/settings";
import type { ApiProviderSettings } from "@/lib/ocr/settings-store";
import type { OrchestratorState } from "@/lib/ocr/pipeline-page-loop";

export interface PostProcessingStageDeps {
  jobId: string;
  settings: ApiProviderSettings;
  postProcessingPayload: PostProcessingSettings;
  postProcessingModel: string;
  pageScopedText: string;
  extractedMarkdown: string;
  snapshot: (snap: ProgressSnapshotInput) => OcrProgressMetadata;
}

export interface PostProcessingStageResult {
  finalMarkdown: string;
  postProcessedText?: string;
  postProcessedJson?: unknown;
  postProcessingForExtractedMetadata: Record<string, unknown>;
}

export async function runPostProcessingStage(
  state: OrchestratorState,
  deps: PostProcessingStageDeps,
): Promise<PostProcessingStageResult> {
  if (!deps.postProcessingPayload.enabled) {
    return {
      finalMarkdown: deps.extractedMarkdown,
      postProcessingForExtractedMetadata: { enabled: false },
    };
  }

  const postProcessingProvider = normalizeProvider(deps.settings.provider);
  if (postProcessingProvider === "ollama") {
    state.usedOllamaModels.add(deps.postProcessingModel);
    await ollamaWarmupWithResolvedHost(deps.settings.apiEndpoint, deps.postProcessingModel);
  }

  state.progressEvents = appendProgressEvent(
    state.progressEvents,
    "post_processing",
    `Running post-processing with ${deps.postProcessingModel}`,
  );
  state.latestMetadata = deps.snapshot({
    stage: "post_processing",
    message: `Applying post-processing with ${deps.postProcessingModel}`,
    progressPct: 90,
    etaSeconds: 2,
  });
  await db.ocrJob.update({
    where: { id: deps.jobId },
    data: { metadata: toJsonValue(state.latestMetadata) },
  });

  const { systemPrompt, userPrompt } = buildPostProcessingPrompt(deps.postProcessingPayload);
  const postProcessRequestText = [
    userPrompt,
    "",
    "OCR source text grouped by page:",
    deps.pageScopedText,
  ].join("\n");

  let finalMarkdown = deps.extractedMarkdown;
  let postProcessedText: string | undefined;
  let postProcessedJson: unknown;

  try {
    const postProcessResult = await runProviderPostProcessing(
      postProcessingProvider,
      deps.settings,
      deps.postProcessingModel,
      systemPrompt,
      postProcessRequestText,
      deps.postProcessingPayload.outputFormat,
    );

    const normalizedPostProcessed = normalizePostProcessedText(
      postProcessResult.text,
      deps.postProcessingPayload.outputFormat,
    );
    if (normalizedPostProcessed.text) {
      postProcessedText = normalizedPostProcessed.text;
      postProcessedJson = normalizedPostProcessed.parsedJson;
      if (deps.postProcessingPayload.outputFormat === "markdown") {
        finalMarkdown = normalizedPostProcessed.text;
      }
    }

    state.postProcessingMeta = {
      enabled: true,
      applied: Boolean(postProcessedText),
      outputFormat: deps.postProcessingPayload.outputFormat,
      instruction: deps.postProcessingPayload.instruction,
      model: deps.postProcessingModel,
      provider: postProcessingProvider,
    };
    return {
      finalMarkdown,
      postProcessedText,
      postProcessedJson,
      postProcessingForExtractedMetadata: {
        ...state.postProcessingMeta,
        ...postProcessResult.metadata,
      },
    };
  } catch (error) {
    state.postProcessingMeta = {
      enabled: true,
      applied: false,
      outputFormat: deps.postProcessingPayload.outputFormat,
      instruction: deps.postProcessingPayload.instruction,
      model: deps.postProcessingModel,
      provider: postProcessingProvider,
      error: errorMessage(error, "Post-processing failed"),
    };
    return {
      finalMarkdown,
      postProcessingForExtractedMetadata: state.postProcessingMeta,
    };
  }
}
