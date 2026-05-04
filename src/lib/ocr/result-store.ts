import { Prisma } from "@prisma/client";

import { resolveAndEnforceS3EndpointPolicy } from "@/lib/ocr/endpoint-policy";
import { createS3EndpointRequestHandler } from "@/lib/s3/guarded-request-handler";

function getS3Config() {
  return {
    bucket: process.env.S3_BUCKET?.trim() || "",
    region: process.env.S3_REGION?.trim() || "us-east-1",
    endpoint: process.env.S3_ENDPOINT?.trim() || "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim() || "",
    prefix: (process.env.S3_PREFIX || "extracto").trim().replace(/^\/+|\/+$/g, ""),
    forcePathStyle:
      (process.env.S3_FORCE_PATH_STYLE || "").trim().toLowerCase() === "true",
  };
}

let s3Client: import("@aws-sdk/client-s3").S3Client | null = null;
let s3LoadError: Error | null = null;

async function getS3Client() {
  if (s3LoadError) throw s3LoadError;
  if (s3Client) return s3Client;
  const cfg = getS3Config();
  try {
    const mod = await import("@aws-sdk/client-s3");
    const endpoint = cfg.endpoint ? await resolveAndEnforceS3EndpointPolicy(cfg.endpoint) : "";
    const requestHandler = endpoint ? await createS3EndpointRequestHandler(endpoint) : undefined;
    s3Client = new mod.S3Client({
      region: cfg.region,
      ...(endpoint ? { endpoint } : {}),
      ...(requestHandler ? { requestHandler } : {}),
      ...(cfg.forcePathStyle ? { forcePathStyle: true } : {}),
      ...(cfg.accessKeyId && cfg.secretAccessKey
        ? {
            credentials: {
              accessKeyId: cfg.accessKeyId,
              secretAccessKey: cfg.secretAccessKey,
            },
          }
        : {}),
    });
    return s3Client;
  } catch (error) {
    s3LoadError = error instanceof Error ? error : new Error(String(error));
    throw s3LoadError;
  }
}

function parseS3Location(location: string): { bucket: string; key: string } | null {
  if (!location.startsWith("s3://")) return null;
  const without = location.slice("s3://".length);
  const slash = without.indexOf("/");
  if (slash < 0) return null;
  return { bucket: without.slice(0, slash), key: without.slice(slash + 1) };
}

export function isRemoteResultStore(): boolean {
  return (process.env.RESULT_STORAGE || "local").trim().toLowerCase() === "s3";
}

async function putS3(key: string, body: string, contentType: string): Promise<{ location: string }> {
  const cfg = getS3Config();
  if (!cfg.bucket) throw new Error("S3_BUCKET is required when RESULT_STORAGE=s3");
  const client = await getS3Client();
  const mod = await import("@aws-sdk/client-s3");
  const fullKey = cfg.prefix ? `${cfg.prefix}/${key}` : key;
  await client.send(
    new mod.PutObjectCommand({ Bucket: cfg.bucket, Key: fullKey, Body: body, ContentType: contentType }),
  );
  return { location: `s3://${cfg.bucket}/${fullKey}` };
}

async function getS3(location: string): Promise<string | null> {
  const parsed = parseS3Location(location);
  if (!parsed) return null;
  const client = await getS3Client();
  const mod = await import("@aws-sdk/client-s3");
  const response = await client.send(new mod.GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
  const body = response.Body;
  if (!body) return null;
  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === "function") {
    return await (body as { transformToString: () => Promise<string> }).transformToString();
  }
  const arrayBuffer = await new Response(body as ReadableStream).arrayBuffer();
  return Buffer.from(arrayBuffer).toString("utf8");
}

async function deleteS3(location: string): Promise<void> {
  const parsed = parseS3Location(location);
  if (!parsed) return;
  const client = await getS3Client();
  const mod = await import("@aws-sdk/client-s3");
  await client.send(new mod.DeleteObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }));
}

export async function maybeUploadResultText(
  jobId: string,
  text: string,
): Promise<{ inline: string | null; location: string | null }> {
  if (!isRemoteResultStore() || !text) {
    return { inline: text || null, location: null };
  }
  const { location } = await putS3(`jobs/${jobId}/extracted-text.txt`, text, "text/plain; charset=utf-8");
  return { inline: null, location };
}

export async function maybeUploadResultJson(
  jobId: string,
  value: unknown,
): Promise<{ inline: Prisma.InputJsonValue | null; location: string | null }> {
  if (!isRemoteResultStore()) {
    return { inline: (value ?? null) as Prisma.InputJsonValue, location: null };
  }
  const serialized = JSON.stringify(value ?? null);
  const { location } = await putS3(`jobs/${jobId}/result.json`, serialized, "application/json; charset=utf-8");
  return { inline: null, location };
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as Record<string, unknown>;
  return e["name"] === "NoSuchKey" || e["Code"] === "NoSuchKey";
}

export async function readResultText(
  location: string | null | undefined,
  inline: string | null | undefined,
): Promise<string | null> {
  if (location && isRemoteResultStore()) {
    try { return await getS3(location); } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }
  return inline ?? null;
}

export async function readResultJson(
  location: string | null | undefined,
  inline: Prisma.JsonValue | null | undefined,
): Promise<unknown> {
  if (location && isRemoteResultStore()) {
    try {
      const text = await getS3(location);
      if (text == null) return null;
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }
  return (inline ?? null) as unknown;
}

export async function deleteResultArtifacts(locations: Array<string | null | undefined>): Promise<void> {
  if (!isRemoteResultStore()) return;
  for (const loc of locations) {
    if (!loc) continue;
    try { await deleteS3(loc); } catch (error) {
      console.error("Result store delete failed:", error);
    }
  }
}
