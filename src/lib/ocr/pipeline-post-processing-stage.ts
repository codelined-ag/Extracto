import { errorMessage } from "@/lib/api-error";
import { db } from "@/lib/db";
import { normalizeProvider } from "@/lib/api-types";
import {
  registerOcrJobAbortController,
  unregisterOcrJobAbortController,
} from "@/lib/ocr/job-control";
import { getOllamaCandidatesForOcr } from "@/lib/ocr/ollama-dispatch";
import { warmupOllamaModel } from "@/lib/ocr/providers/ollama";
import {
  appendProgressEvent,
  POST_PROCESSING_KICKOFF_PCT,
  type OcrProgressMetadata,
  type ProgressSnapshotInput,
} from "@/lib/ocr/pipeline-progress";
import {
  buildPostProcessingPrompt,
  normalizePostProcessedText,
} from "@/lib/ocr/pipeline-post-processing";
import { toJsonValue } from "@/lib/ocr/pipeline-result-builder";
import { runProviderPostProcessing } from "@/lib/ocr/provider-dispatch";
import { OcrStopRequestedError } from "@/lib/ocr/providers/shared";
import type { PostProcessingSettings } from "@/lib/ocr/settings";
import type { ApiProviderSettings } from "@/lib/api-types";
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
    await warmupOllamaModel(getOllamaCandidatesForOcr(deps.settings.apiEndpoint), deps.postProcessingModel);
  }

  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  state.progressEvents = appendProgressEvent(
    state.progressEvents,
    "post_processing",
    `Running post-processing with ${deps.postProcessingModel}`,
  );
  state.postProcessingMeta = {
    enabled: true,
    outputFormat: deps.postProcessingPayload.outputFormat,
    instruction: deps.postProcessingPayload.instruction,
    model: deps.postProcessingModel,
    provider: postProcessingProvider,
    startedAt: startedAtIso,
    elapsedMs: 0,
  };
  state.latestMetadata = deps.snapshot({
    stage: "post_processing",
    message: `Applying post-processing with ${deps.postProcessingModel}`,
    progressPct: POST_PROCESSING_KICKOFF_PCT,
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

  let heartbeatCancelled = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const tickHeartbeat = async () => {
    if (heartbeatCancelled) return;
    const elapsed = Date.now() - startedAtMs;
    const elapsedSec = Math.floor(elapsed / 1000);
    const softPct = Math.min(99, POST_PROCESSING_KICKOFF_PCT + Math.floor(elapsed / 1500));
    state.postProcessingMeta = {
      ...(state.postProcessingMeta ?? {}),
      enabled: true,
      outputFormat: deps.postProcessingPayload.outputFormat,
      instruction: deps.postProcessingPayload.instruction,
      model: deps.postProcessingModel,
      provider: postProcessingProvider,
      startedAt: startedAtIso,
      elapsedMs: elapsed,
    };
    const snap = deps.snapshot({
      stage: "post_processing",
      message: `Post-processing... ${elapsedSec}s elapsed`,
      progressPct: softPct,
      etaSeconds: null,
    });
    if (heartbeatCancelled) return;
    state.latestMetadata = snap;
    try {
      await db.ocrJob.updateMany({
        where: { id: deps.jobId, status: "PROCESSING" },
        data: { metadata: toJsonValue(snap) },
      });
    } catch { /* heartbeat write failures are non-fatal */ }
    if (heartbeatCancelled) return;
    heartbeatTimer = setTimeout(() => { void tickHeartbeat(); }, 1500);
  };
  heartbeatTimer = setTimeout(() => { void tickHeartbeat(); }, 1500);

  const postProcessAbort = new AbortController();
  registerOcrJobAbortController(deps.jobId, postProcessAbort);
  try {
    const postProcessResult = await runProviderPostProcessing(
      postProcessingProvider,
      deps.settings,
      deps.postProcessingModel,
      systemPrompt,
      postProcessRequestText,
      deps.postProcessingPayload.outputFormat,
      postProcessAbort.signal,
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
      startedAt: startedAtIso,
      elapsedMs: Date.now() - startedAtMs,
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
    if (error instanceof OcrStopRequestedError) throw error;
    state.postProcessingMeta = {
      enabled: true,
      applied: false,
      outputFormat: deps.postProcessingPayload.outputFormat,
      instruction: deps.postProcessingPayload.instruction,
      model: deps.postProcessingModel,
      provider: postProcessingProvider,
      error: errorMessage(error, "Post-processing failed"),
      startedAt: startedAtIso,
      elapsedMs: Date.now() - startedAtMs,
    };
    return {
      finalMarkdown,
      postProcessingForExtractedMetadata: state.postProcessingMeta,
    };
  } finally {
    heartbeatCancelled = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    unregisterOcrJobAbortController(deps.jobId, postProcessAbort);
  }
}
