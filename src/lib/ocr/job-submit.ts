import { OcrJobStatus } from "@prisma/client";

import { ApiRouteError } from "@/lib/api-error";
import type { ApiProviderSettings, ProviderKind } from "@/lib/api-types";
import { db } from "@/lib/db";
import { dispatchJobWebhooks } from "@/lib/background/webhooks";
import { withOcrJobSlot } from "@/lib/ocr/job-control";
import { seedPostProcessingMeta } from "@/lib/ocr/job-seed";
import {
  processOcrJobInBackground,
} from "@/lib/ocr/pipeline";
import {
  buildProgressMetadata,
  ocrStageProgressPct,
  type OcrProgressEvent,
} from "@/lib/ocr/pipeline-progress";
import {
  toJsonValue,
  toPageCheckpoint,
  type ProcessedPageOutput,
} from "@/lib/ocr/pipeline-result-builder";
import type { AdvancedSettings, PostProcessingSettings } from "@/lib/ocr/settings";

export interface SubmitOcrJobInput {
  userId: string;
  apiKeyId: string | null;
  fileName: string;
  model: string;
  ocrModel: string;
  provider: ProviderKind;
  settings: ApiProviderSettings;
  settingsPayload: AdvancedSettings;
  postProcessingPayload: PostProcessingSettings;
  inputPreviews: string[];
  pageNumbers?: number[];
  pageAnchors?: import("@/lib/ocr/pdf-anchoring").AnchorPage[];
  prompt: string;
  sourcePreview: string | null;
  priority?: number;
  batchId?: string | null;
  startedAtMs?: number;
}

export interface ResumeOcrJobInput extends SubmitOcrJobInput {
  jobId: string;
}

export interface ResumeOcrJobResult {
  jobId: string;
  pageCount: number;
  pageRecords: number;
}

function buildQueuedEvents(
  startedAtIso: string,
  initialMessage: string,
  provider: ProviderKind,
  ocrModel: string,
  inferenceModel: string,
): OcrProgressEvent[] {
  const events: OcrProgressEvent[] = [
    { at: startedAtIso, stage: "queued", message: initialMessage },
  ];
  if (provider === "mistral" && ocrModel !== inferenceModel) {
    events.push({
      at: startedAtIso,
      stage: "queued",
      message: `OCR will use ${ocrModel}; selected inference model is ${inferenceModel}`,
    });
  }
  return events;
}

function kickoffProcessing(
  jobId: string,
  priority: number,
  input: SubmitOcrJobInput,
  startedAtMs: number,
  resumeExtras: { initialPageOutputs?: ProcessedPageOutput[]; startIndex?: number; resumed?: boolean } = {},
): void {
  void withOcrJobSlot(priority, () =>
    processOcrJobInBackground({
      jobId,
      startedAtMs,
      fileName: input.fileName,
      model: input.model,
      ocrModel: input.ocrModel,
      provider: input.provider,
      settings: input.settings,
      settingsPayload: input.settingsPayload,
      postProcessingPayload: input.postProcessingPayload,
      inputPreviews: input.inputPreviews,
      pageNumbers: input.pageNumbers,
      pageAnchors: input.pageAnchors,
      prompt: input.prompt,
      ...resumeExtras,
    }),
  );
}

export function parseCheckpointPages(result: unknown, metadata?: unknown): ProcessedPageOutput[] {
  const rawCheckpointPages =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as { pageRecords?: unknown }).pageRecords
      : undefined;
  const fromResult = result && typeof result === "object" && !Array.isArray(result)
    ? (result as { metadata?: { pageRecords?: unknown } }).metadata?.pageRecords
    : undefined;
  const checkpointSource = Array.isArray(rawCheckpointPages) ? rawCheckpointPages : fromResult;

  if (!Array.isArray(checkpointSource)) {
    return [];
  }

  return checkpointSource
    .map((page) => {
      if (!page || typeof page !== "object" || Array.isArray(page)) return null;
      const typed = page as {
        pageNumber?: unknown;
        text?: unknown;
        structured?: unknown;
        durationMs?: unknown;
        metadata?: unknown;
      };
      if (typeof typed.pageNumber !== "number" || typeof typed.text !== "string") return null;
      return {
        pageNumber: typed.pageNumber,
        text: typed.text,
        structured:
          typed.structured && typeof typed.structured === "object" && !Array.isArray(typed.structured)
            ? (typed.structured as Record<string, unknown>)
            : { markdown: typed.text },
        durationMs: typeof typed.durationMs === "number" ? typed.durationMs : 0,
        metadata:
          typed.metadata && typeof typed.metadata === "object" && !Array.isArray(typed.metadata)
            ? (typed.metadata as Record<string, unknown>)
            : {},
      };
    })
    .filter((page): page is ProcessedPageOutput => Boolean(page))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function submitOcrJob(
  input: SubmitOcrJobInput,
): Promise<{ jobId: string; pageCount: number }> {
  const startedAtMs = input.startedAtMs ?? Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const priority = input.priority ?? 0;

  const initialMetadata = buildProgressMetadata({
    stage: "queued",
    message: "Queued for OCR",
    progressPct: 0,
    pageCount: input.inputPreviews.length,
    processedPages: 0,
    currentPage: null,
    etaSeconds: null,
    startedAt: startedAtIso,
    events: buildQueuedEvents(startedAtIso, "Job created", input.provider, input.ocrModel, input.model),
    checkpoints: [],
    pageNumbers: input.pageNumbers,
    postProcessing: seedPostProcessingMeta(
      input.postProcessingPayload,
      input.postProcessingPayload.model || input.model,
    ),
  });

  const createdJob = await db.ocrJob.create({
    data: {
      userId: input.userId,
      apiKeyId: input.apiKeyId,
      status: OcrJobStatus.PROCESSING,
      priority,
      batchId: input.batchId ?? null,
      fileName: input.fileName,
      sourcePreview: input.sourcePreview,
      model: input.model,
      language: input.settingsPayload.language,
      tableDetection: input.settingsPayload.tableDetection,
      handwritingRecognition: input.settingsPayload.handwritingRecognition,
      preserveFormatting: input.settingsPayload.preserveFormatting,
      customPrompt: input.settingsPayload.customPrompt,
      quality: input.settingsPayload.quality,
      settingsSnapshot: toJsonValue({
        settings: input.settingsPayload,
        postProcessing: input.postProcessingPayload,
      }),
      prompt: input.prompt,
      metadata: toJsonValue(initialMetadata),
    },
    select: { id: true },
  });

  kickoffProcessing(createdJob.id, priority, input, startedAtMs);
  void dispatchJobWebhooks(createdJob.id, "job.created").catch(() => undefined);

  return { jobId: createdJob.id, pageCount: input.inputPreviews.length };
}

export async function resumeOcrJob(input: ResumeOcrJobInput): Promise<ResumeOcrJobResult> {
  const startedAtMs = input.startedAtMs ?? Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();

  const existingJob = await db.ocrJob.findFirst({
    where: { id: input.jobId, userId: input.userId },
    select: { id: true, status: true, result: true, metadata: true, priority: true },
  });
  if (!existingJob) {
    throw new ApiRouteError("Resume job not found", 404);
  }
  if (existingJob.status === OcrJobStatus.COMPLETED) {
    throw new ApiRouteError("Job is already completed", 400);
  }
  if (existingJob.status === OcrJobStatus.PROCESSING) {
    throw new ApiRouteError("Job is already processing", 409);
  }

  const initialPageOutputs = parseCheckpointPages(existingJob.result, existingJob.metadata);
  const startIndex = initialPageOutputs.length;
  if (startIndex >= input.inputPreviews.length) {
    throw new ApiRouteError("All pages were already checkpointed for this job", 400);
  }

  const persistedPageNumbers = (() => {
    if (!existingJob.metadata || typeof existingJob.metadata !== "object" || Array.isArray(existingJob.metadata)) {
      return undefined;
    }
    const raw = (existingJob.metadata as { pageNumbers?: unknown }).pageNumbers;
    if (!Array.isArray(raw)) return undefined;
    const cleaned = raw.filter(
      (n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1,
    );
    return cleaned.length === raw.length ? cleaned : undefined;
  })();

  const effectivePageNumbers =
    persistedPageNumbers && persistedPageNumbers.length === input.inputPreviews.length
      ? persistedPageNumbers
      : input.pageNumbers;
  if (
    persistedPageNumbers &&
    persistedPageNumbers.length !== input.inputPreviews.length
  ) {
    console.warn(
      `Resume job ${input.jobId}: persisted pageNumbers length (${persistedPageNumbers.length}) does not match resumed inputPreviews length (${input.inputPreviews.length}); falling back to client-supplied pageNumbers.`,
    );
  }
  const effectivePageAnchors = input.pageAnchors;
  if (input.pageAnchors && input.pageAnchors.length !== input.inputPreviews.length) {
    console.warn(
      `Resume job ${input.jobId}: client-supplied pageAnchors length (${input.pageAnchors.length}) does not match inputPreviews length (${input.inputPreviews.length}); anchors will not align.`,
    );
  }

  if (
    persistedPageNumbers &&
    input.pageNumbers &&
    (input.pageNumbers.length !== persistedPageNumbers.length ||
      input.pageNumbers.some((n, i) => n !== persistedPageNumbers[i]))
  ) {
    throw new ApiRouteError(
      "Resume pageNumbers does not match the original sparse selection persisted on the job",
      400,
    );
  }

  const resumeMetadata = buildProgressMetadata({
    stage: "queued",
    message: `Resume requested from page ${startIndex + 1}/${input.inputPreviews.length}`,
    progressPct: ocrStageProgressPct(startIndex, input.inputPreviews.length, input.postProcessingPayload.enabled),
    pageCount: input.inputPreviews.length,
    processedPages: startIndex,
    currentPage: null,
    etaSeconds: null,
    startedAt: startedAtIso,
    events: buildQueuedEvents(startedAtIso, "Resume requested", input.provider, input.ocrModel, input.model),
    checkpoints: initialPageOutputs.map(toPageCheckpoint),
    pageNumbers: effectivePageNumbers,
    postProcessing: seedPostProcessingMeta(
      input.postProcessingPayload,
      input.postProcessingPayload.model || input.model,
    ),
  });

  await db.ocrJob.update({
    where: { id: existingJob.id },
    data: {
      status: OcrJobStatus.PROCESSING,
      sourcePreview: input.sourcePreview,
      errorMessage: null,
      completedAt: null,
      processingMs: null,
      settingsSnapshot: toJsonValue({
        settings: input.settingsPayload,
        postProcessing: input.postProcessingPayload,
      }),
      prompt: input.prompt,
      metadata: toJsonValue(resumeMetadata),
    },
  });

  const priority = existingJob.priority ?? input.priority ?? 0;
  kickoffProcessing(
    existingJob.id,
    priority,
    { ...input, pageNumbers: effectivePageNumbers, pageAnchors: effectivePageAnchors },
    startedAtMs,
    {
      initialPageOutputs,
      startIndex,
      resumed: true,
    },
  );

  return { jobId: existingJob.id, pageCount: input.inputPreviews.length, pageRecords: startIndex };
}
