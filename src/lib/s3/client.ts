import { resolveAndEnforceS3EndpointPolicy } from "@/lib/ocr/endpoint-policy";
import type { S3Defaults } from "@/lib/s3/defaults-store";
import { createS3EndpointRequestHandler } from "@/lib/s3/guarded-request-handler";

export type S3ClientType = import("@aws-sdk/client-s3").S3Client;

let sdkPromise: Promise<typeof import("@aws-sdk/client-s3")> | null = null;

async function loadSdk(): Promise<typeof import("@aws-sdk/client-s3")> {
  if (!sdkPromise) sdkPromise = import("@aws-sdk/client-s3");
  return sdkPromise;
}

const BUCKET_REGEX = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_REGEX = /^[a-z]{2,4}-[a-z]+-\d{1,2}$/;
const KEY_PART_FORBIDDEN = /[\x00-\x1f\x7f]/;

function validateBucket(bucket: string): void {
  if (!BUCKET_REGEX.test(bucket)) {
    throw new Error(`Invalid S3 bucket name "${bucket}" (must be 3-63 lowercase chars, digits, dot, hyphen).`);
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error(`S3 bucket name "${bucket}" looks like an IP address.`);
  }
  if (bucket.includes("..")) {
    throw new Error(`S3 bucket name "${bucket}" contains consecutive dots.`);
  }
}

function validateRegion(region: string): void {
  if (region && !REGION_REGEX.test(region)) {
    throw new Error(`Invalid S3 region "${region}".`);
  }
}

function validatePrefix(prefix: string): void {
  if (KEY_PART_FORBIDDEN.test(prefix)) {
    throw new Error("S3 prefix contains control characters.");
  }
  if (prefix.split("/").includes("..")) {
    throw new Error('S3 prefix contains a ".." segment.');
  }
}

export async function buildUserS3Client(defaults: S3Defaults): Promise<{
  client: S3ClientType;
  sdk: typeof import("@aws-sdk/client-s3");
  bucket: string;
  prefix: string;
}> {
  if (!defaults.bucket) throw new Error("S3 bucket is not configured");
  validateBucket(defaults.bucket);
  validateRegion(defaults.region || "us-east-1");
  validatePrefix(defaults.prefix);

  const endpoint = defaults.endpoint ? await resolveAndEnforceS3EndpointPolicy(defaults.endpoint) : "";
  const requestHandler = endpoint ? await createS3EndpointRequestHandler(endpoint) : undefined;

  const sdk = await loadSdk();
  const client = new sdk.S3Client({
    region: defaults.region || "us-east-1",
    ...(endpoint ? { endpoint } : {}),
    ...(requestHandler ? { requestHandler } : {}),
    ...(defaults.forcePathStyle ? { forcePathStyle: true } : {}),
    ...(defaults.accessKeyId && defaults.secretAccessKey
      ? {
          credentials: {
            accessKeyId: defaults.accessKeyId,
            secretAccessKey: defaults.secretAccessKey,
          },
        }
      : {}),
  });
  return { client, sdk, bucket: defaults.bucket, prefix: defaults.prefix.replace(/^\/+|\/+$/g, "") };
}

export function assertKeyUnderPrefix(prefix: string, key: string): void {
  if (!key) throw new Error("S3 key is required");
  if (KEY_PART_FORBIDDEN.test(key)) throw new Error("S3 key contains control characters");
  if (key.split("/").includes("..")) throw new Error('S3 key contains a ".." segment');
  if (prefix && !key.startsWith(`${prefix}/`) && key !== prefix) {
    throw new Error(`S3 key "${key}" is outside the configured prefix "${prefix}/"`);
  }
}

export function joinKey(prefix: string, key: string): string {
  return prefix ? `${prefix}/${key}` : key;
}
