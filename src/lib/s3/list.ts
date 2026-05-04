import { assertKeyUnderPrefix, buildUserS3Client, joinKey } from "@/lib/s3/client";
import { getS3Defaults } from "@/lib/s3/defaults-store";

export interface S3ListItem {
  key: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
}

export interface S3ListResult {
  bucket: string;
  prefix: string;
  items: S3ListItem[];
  nextToken: string | null;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const DEFAULT_OCR_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
]);

export interface S3ListOptions {
  /** Sub-prefix appended under the user's `defaults.prefix`. */
  subPrefix?: string;
  pageSize?: number;
  continuationToken?: string;
  /** When true (default), only list keys with OCR-able extensions. */
  filterOcrExtensions?: boolean;
}

export async function listS3Objects(
  userId: string,
  options: S3ListOptions = {},
): Promise<S3ListResult> {
  const defaults = await getS3Defaults(userId);
  if (!defaults.bucket) {
    throw new Error("S3 bucket is not configured. Set it in Settings → S3.");
  }
  const { client, sdk, bucket, prefix } = await buildUserS3Client(defaults);

  const sub = (options.subPrefix ?? "").replace(/^\/+|\/+$/g, "");
  const fullPrefix = sub ? joinKey(prefix, sub) : prefix;
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, options.pageSize ?? DEFAULT_PAGE_SIZE));

  const resp = await client.send(
    new sdk.ListObjectsV2Command({
      Bucket: bucket,
      Prefix: fullPrefix ? `${fullPrefix.replace(/\/+$/, "")}/` : undefined,
      MaxKeys: pageSize,
      ContinuationToken: options.continuationToken || undefined,
    }),
  );

  const filterExt = options.filterOcrExtensions !== false;
  const items: S3ListItem[] = [];
  for (const obj of resp.Contents ?? []) {
    const key = obj.Key ?? "";
    if (!key) continue;
    if (filterExt) {
      const dot = key.lastIndexOf(".");
      if (dot < 0) continue;
      const ext = key.slice(dot).toLowerCase();
      if (!DEFAULT_OCR_EXTENSIONS.has(ext)) continue;
    }
    items.push({
      key,
      size: obj.Size ?? 0,
      lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
      etag: obj.ETag ?? null,
    });
  }

  return {
    bucket,
    prefix: fullPrefix,
    items,
    nextToken: resp.IsTruncated && resp.NextContinuationToken ? resp.NextContinuationToken : null,
  };
}

export interface S3DownloadHandle {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}

export async function openS3Download(
  userId: string,
  key: string,
  maxBytes: number,
): Promise<S3DownloadHandle> {
  const defaults = await getS3Defaults(userId);
  if (!defaults.bucket) throw new Error("S3 bucket is not configured.");
  const { client, sdk, bucket, prefix } = await buildUserS3Client(defaults);
  assertKeyUnderPrefix(prefix, key);

  const head = await client.send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key }));
  const size = head.ContentLength ?? 0;
  if (size > maxBytes) {
    throw Object.assign(new Error(`Object is too large (${size} bytes; max ${maxBytes})`), {
      statusCode: 413,
    });
  }

  const get = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = get.Body;
  if (!body) throw new Error("Empty response from S3");

  let stream: ReadableStream<Uint8Array>;
  if (typeof (body as { transformToWebStream?: () => ReadableStream<Uint8Array> }).transformToWebStream === "function") {
    stream = (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
  } else {
    stream = body as ReadableStream<Uint8Array>;
  }

  return {
    stream,
    contentType: get.ContentType ?? "application/octet-stream",
    size,
  };
}
