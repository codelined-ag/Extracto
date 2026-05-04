import { db } from "@/lib/db";
import { readResultJson, readResultText } from "@/lib/ocr/result-store";
import { buildUserS3Client, joinKey } from "@/lib/s3/client";
import { getS3Defaults } from "@/lib/s3/defaults-store";
import { updateS3Export } from "@/lib/s3/export-progress";

export interface S3ExportInput {
  exportId: string;
  userId: string;
  jobId: string;
  /** Optional override of `<prefix>/<jobId>` — caller-supplied key prefix, joined under the user's `defaults.prefix`. */
  keyPrefix?: string;
}

export interface S3ExportResult {
  bucket: string;
  keys: string[];
  totalBytes: number;
}

function safeFileNameStem(name: string, fallback: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._]+/g, "").slice(0, 120);
  return cleaned || fallback;
}

function sanitizeKeyPrefix(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new Error("keyPrefix contains control characters");
  }
  const segments = trimmed.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.includes("..")) {
    throw new Error('keyPrefix contains a ".." segment');
  }
  return segments.join("/");
}

export async function runS3Export(input: S3ExportInput): Promise<S3ExportResult> {
  const job = await db.ocrJob.findFirst({
    where: { id: input.jobId, userId: input.userId },
    select: {
      id: true,
      fileName: true,
      extractedText: true,
      extractedTextLocation: true,
      result: true,
      resultLocation: true,
    },
  });
  if (!job) throw new Error(`Job ${input.jobId} not found`);

  updateS3Export(input.exportId, { phase: "reading", message: "Loading job result" });

  const [text, json] = await Promise.all([
    readResultText(job.extractedTextLocation, job.extractedText),
    readResultJson(job.resultLocation, job.result),
  ]);
  const md = text ?? "";
  const jsonString = JSON.stringify(json ?? {}, null, 2);

  const defaults = await getS3Defaults(input.userId);
  if (!defaults.bucket) throw new Error("S3 bucket is not configured. Set it in Settings → S3.");

  const { client, sdk, bucket, prefix } = await buildUserS3Client(defaults);
  const stem = safeFileNameStem(job.fileName ?? job.id, job.id);
  const sanitized = sanitizeKeyPrefix(input.keyPrefix);
  const callerPrefix = (sanitized ?? stem).replace(/^\/+|\/+$/g, "");
  const baseKey = joinKey(prefix, callerPrefix);
  const mdKey = `${baseKey}/${job.id}.md`;
  const jsonKey = `${baseKey}/${job.id}.json`;

  const totalBytes = Buffer.byteLength(md, "utf8") + Buffer.byteLength(jsonString, "utf8");
  updateS3Export(input.exportId, {
    phase: "uploading",
    message: `Uploading 2 objects to ${bucket}`,
    totalBytes,
    uploadedBytes: 0,
  });

  await client.send(
    new sdk.PutObjectCommand({
      Bucket: bucket,
      Key: mdKey,
      Body: md,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
  updateS3Export(input.exportId, {
    uploadedBytes: Buffer.byteLength(md, "utf8"),
    keys: [mdKey],
  });

  await client.send(
    new sdk.PutObjectCommand({
      Bucket: bucket,
      Key: jsonKey,
      Body: jsonString,
      ContentType: "application/json; charset=utf-8",
    }),
  );

  updateS3Export(input.exportId, {
    phase: "done",
    uploadedBytes: totalBytes,
    keys: [mdKey, jsonKey],
    bucket,
    message: "Upload complete",
  });

  return { bucket, keys: [mdKey, jsonKey], totalBytes };
}
