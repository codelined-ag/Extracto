import { OcrJobStatus } from "@prisma/client";

import { db } from "@/lib/db";
import { readResultText } from "@/lib/ocr/result-store";

const POLL_INTERVAL_MS = 1_000;
const MAX_WAIT_MS = 5 * 60 * 1_000;

export type WaitForOcrJobOutcome =
  | { kind: "completed"; text: string }
  | { kind: "failed"; errorMessage: string }
  | { kind: "missing" }
  | { kind: "timeout" };

export interface WaitForOcrJobOptions {
  jobId: string;
  /** Defaults to 1000ms. */
  pollIntervalMs?: number;
  /** Defaults to 5 minutes. */
  maxWaitMs?: number;
}

/**
 * Poll the ocrJob row until COMPLETED, FAILED, the row disappears, or
 * the deadline expires. Used by the OpenAI-compat adapter so the route
 * shell only handles envelope translation, not polling glue.
 */
export async function waitForOcrJobCompletion({
  jobId,
  pollIntervalMs = POLL_INTERVAL_MS,
  maxWaitMs = MAX_WAIT_MS,
}: WaitForOcrJobOptions): Promise<WaitForOcrJobOutcome> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const job = await db.ocrJob.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        extractedText: true,
        extractedTextLocation: true,
        errorMessage: true,
      },
    });
    if (!job) return { kind: "missing" };
    if (job.status === OcrJobStatus.COMPLETED) {
      const text = await readResultText(job.extractedTextLocation, job.extractedText);
      return { kind: "completed", text: text ?? "" };
    }
    if (job.status === OcrJobStatus.FAILED) {
      return { kind: "failed", errorMessage: job.errorMessage ?? "OCR job failed" };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return { kind: "timeout" };
}
