import type { S3Defaults } from "@/lib/s3/defaults-store";

export type S3ClientType = import("@aws-sdk/client-s3").S3Client;

let sdkPromise: Promise<typeof import("@aws-sdk/client-s3")> | null = null;

async function loadSdk(): Promise<typeof import("@aws-sdk/client-s3")> {
  if (!sdkPromise) sdkPromise = import("@aws-sdk/client-s3");
  return sdkPromise;
}

export async function buildUserS3Client(defaults: S3Defaults): Promise<{
  client: S3ClientType;
  sdk: typeof import("@aws-sdk/client-s3");
  bucket: string;
  prefix: string;
}> {
  if (!defaults.bucket) {
    throw new Error("S3 bucket is not configured");
  }
  const sdk = await loadSdk();
  const client = new sdk.S3Client({
    region: defaults.region || "us-east-1",
    ...(defaults.endpoint ? { endpoint: defaults.endpoint } : {}),
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

export function joinKey(prefix: string, key: string): string {
  return prefix ? `${prefix}/${key}` : key;
}
