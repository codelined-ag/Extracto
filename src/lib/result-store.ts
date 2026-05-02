import { Prisma } from "@prisma/client";

const S3_BUCKET = process.env.S3_BUCKET?.trim() || "";
const S3_REGION = process.env.S3_REGION?.trim() || "us-east-1";
const S3_ENDPOINT = process.env.S3_ENDPOINT?.trim() || "";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID?.trim() || "";
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY?.trim() || "";
const S3_PREFIX = (process.env.S3_PREFIX || "extracto").trim().replace(/^\/+|\/+$/g, "");
const S3_FORCE_PATH_STYLE =
  (process.env.S3_FORCE_PATH_STYLE || "").trim().toLowerCase() === "true";

interface ResultStore {
  put(key: string, body: string, contentType: string): Promise<{ location: string }>;
  get(location: string): Promise<string | null>;
  delete(location: string): Promise<void>;
}

class LocalResultStore implements ResultStore {
  async put(_key: string, _body: string, _contentType: string): Promise<{ location: string }> {
    return { location: "" };
  }
  async get(_location: string): Promise<string | null> {
    return null;
  }
  async delete(_location: string): Promise<void> {
    // noop
  }
}

let s3Client: import("@aws-sdk/client-s3").S3Client | null = null;
let s3LoadError: Error | null = null;

async function getS3Client() {
  if (s3LoadError) throw s3LoadError;
  if (s3Client) return s3Client;
  try {
    const mod = await import("@aws-sdk/client-s3");
    s3Client = new mod.S3Client({
      region: S3_REGION,
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
      ...(S3_FORCE_PATH_STYLE ? { forcePathStyle: true } : {}),
      ...(S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: S3_ACCESS_KEY_ID,
              secretAccessKey: S3_SECRET_ACCESS_KEY,
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

class S3ResultStore implements ResultStore {
  async put(key: string, body: string, contentType: string): Promise<{ location: string }> {
    if (!S3_BUCKET) {
      throw new Error("S3_BUCKET is required when RESULT_STORAGE=s3");
    }
    const client = await getS3Client();
    const mod = await import("@aws-sdk/client-s3");
    const fullKey = S3_PREFIX ? `${S3_PREFIX}/${key}` : key;
    await client.send(
      new mod.PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: fullKey,
        Body: body,
        ContentType: contentType,
      })
    );
    return { location: `s3://${S3_BUCKET}/${fullKey}` };
  }

  async get(location: string): Promise<string | null> {
    const parsed = parseS3Location(location);
    if (!parsed) return null;
    const { bucket, key } = parsed;

    const client = await getS3Client();
    const mod = await import("@aws-sdk/client-s3");
    const response = await client.send(
      new mod.GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = response.Body;
    if (!body) return null;
    if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === "function") {
      return await (body as { transformToString: () => Promise<string> }).transformToString();
    }
    const arrayBuffer = await new Response(body as ReadableStream).arrayBuffer();
    return Buffer.from(arrayBuffer).toString("utf8");
  }

  async delete(location: string): Promise<void> {
    const parsed = parseS3Location(location);
    if (!parsed) return;
    const { bucket, key } = parsed;

    const client = await getS3Client();
    const mod = await import("@aws-sdk/client-s3");
    await client.send(new mod.DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}

let _store: ResultStore | null = null;

function getStore(): ResultStore {
  if (!_store) {
    _store = (process.env.RESULT_STORAGE || "local").trim().toLowerCase() === "s3"
      ? new S3ResultStore()
      : new LocalResultStore();
  }
  return _store;
}

export function isRemoteResultStore(): boolean {
  return (process.env.RESULT_STORAGE || "local").trim().toLowerCase() === "s3";
}

export async function maybeUploadResultText(
  jobId: string,
  text: string
): Promise<{ inline: string | null; location: string | null }> {
  if (!isRemoteResultStore() || !text) {
    return { inline: text || null, location: null };
  }
  const { location } = await getStore().put(
    `jobs/${jobId}/extracted-text.txt`,
    text,
    "text/plain; charset=utf-8"
  );
  return { inline: null, location };
}

export async function maybeUploadResultJson(
  jobId: string,
  value: unknown
): Promise<{ inline: Prisma.InputJsonValue | null; location: string | null }> {
  if (!isRemoteResultStore()) {
    return { inline: (value ?? null) as Prisma.InputJsonValue, location: null };
  }
  const serialized = JSON.stringify(value ?? null);
  const { location } = await getStore().put(
    `jobs/${jobId}/result.json`,
    serialized,
    "application/json; charset=utf-8"
  );
  return { inline: null, location };
}

export async function readResultText(
  location: string | null | undefined,
  inline: string | null | undefined
): Promise<string | null> {
  if (location) {
    try {
      return await getStore().get(location);
    } catch (error) {
      console.error("Result store read (text) failed:", error);
      return null;
    }
  }
  return inline ?? null;
}

export async function readResultJson(
  location: string | null | undefined,
  inline: Prisma.JsonValue | null | undefined
): Promise<unknown> {
  if (location) {
    try {
      const text = await getStore().get(location);
      if (text == null) return null;
      return JSON.parse(text) as unknown;
    } catch (error) {
      console.error("Result store read (json) failed:", error);
      return null;
    }
  }
  return (inline ?? null) as unknown;
}

export async function deleteResultArtifacts(locations: Array<string | null | undefined>): Promise<void> {
  if (!isRemoteResultStore()) return;
  for (const loc of locations) {
    if (!loc) continue;
    try {
      await getStore().delete(loc);
    } catch (error) {
      console.error("Result store delete failed:", error);
    }
  }
}
