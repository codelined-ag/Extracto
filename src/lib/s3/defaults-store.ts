import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { decryptAtRest, encryptAtRest, isEncryptedAtRest } from "@/lib/auth/secret-at-rest";
import { enforceS3EndpointPolicy } from "@/lib/ocr/endpoint-policy";

const S3_SECRET_DOMAIN = "s3-credentials";

function encryptSecretAccessKey(plaintext: string): string {
  return plaintext.length > 0 ? encryptAtRest(plaintext, S3_SECRET_DOMAIN) : "";
}

function decryptSecretAccessKey(stored: string): string {
  if (!stored) return "";
  if (!isEncryptedAtRest(stored)) return stored;
  return decryptAtRest(stored, S3_SECRET_DOMAIN);
}

export interface S3Defaults {
  bucket: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  forcePathStyle: boolean;
}

export type ClientS3Defaults = Omit<S3Defaults, "secretAccessKey"> & {
  hasSecretAccessKey: boolean;
};

const DEFAULTS: S3Defaults = {
  bucket: "",
  region: "us-east-1",
  endpoint: "",
  accessKeyId: "",
  secretAccessKey: "",
  prefix: "extracto",
  forcePathStyle: false,
};

const cache = new Map<string, S3Defaults>();
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

function getDataRoot(): string {
  const envDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (!envDatabaseUrl?.startsWith("file:")) return process.cwd();
  return path.dirname(envDatabaseUrl.replace(/^file:/u, ""));
}

function getDefaultsDir(): string {
  return path.join(getDataRoot(), "s3-defaults");
}

function sanitizeUserId(userId: string): string {
  return userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getDefaultsPath(userId: string): string {
  return path.join(getDefaultsDir(), `${sanitizeUserId(userId)}.json`);
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalize(raw: Partial<S3Defaults>): S3Defaults {
  return {
    bucket: asString(raw.bucket, DEFAULTS.bucket).slice(0, 200),
    region: asString(raw.region, DEFAULTS.region).slice(0, 64) || DEFAULTS.region,
    endpoint: asString(raw.endpoint, DEFAULTS.endpoint).slice(0, 400),
    accessKeyId: asString(raw.accessKeyId, DEFAULTS.accessKeyId).slice(0, 200),
    secretAccessKey: typeof raw.secretAccessKey === "string" ? raw.secretAccessKey : DEFAULTS.secretAccessKey,
    prefix: asString(raw.prefix, DEFAULTS.prefix).replace(/^\/+|\/+$/g, "").slice(0, 200),
    forcePathStyle: Boolean(raw.forcePathStyle),
  };
}

export async function getS3Defaults(userId: string): Promise<S3Defaults> {
  const safe = sanitizeUserId(userId);
  const cached = cache.get(safe);
  if (cached) return structuredClone(cached);
  try {
    const stored = await readFile(getDefaultsPath(safe), "utf8");
    const parsed = JSON.parse(stored) as Partial<S3Defaults>;
    const normalized = normalize(parsed);
    if (normalized.secretAccessKey) {
      normalized.secretAccessKey = decryptSecretAccessKey(normalized.secretAccessKey);
    }
    cache.set(safe, normalized);
    return structuredClone(normalized);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[s3-defaults] read failure:", err);
    }
    const normalized = normalize(DEFAULTS);
    cache.set(safe, normalized);
    return structuredClone(normalized);
  }
}

export interface SaveS3DefaultsInput extends Record<string, unknown> {
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  replaceSecretAccessKey?: boolean;
  prefix?: string;
  forcePathStyle?: boolean;
}

export async function saveS3Defaults(userId: string, input: SaveS3DefaultsInput): Promise<S3Defaults> {
  const safe = sanitizeUserId(userId);
  const current = await getS3Defaults(safe);

  const proposedEndpoint = (input.endpoint ?? current.endpoint).trim();
  if (proposedEndpoint) enforceS3EndpointPolicy(proposedEndpoint);

  const merged: S3Defaults = {
    bucket: input.bucket ?? current.bucket,
    region: input.region ?? current.region,
    endpoint: proposedEndpoint,
    accessKeyId: input.accessKeyId ?? current.accessKeyId,
    secretAccessKey: input.replaceSecretAccessKey
      ? (input.secretAccessKey ?? "")
      : current.secretAccessKey,
    prefix: input.prefix ?? current.prefix,
    forcePathStyle: input.forcePathStyle ?? current.forcePathStyle,
  };

  const normalized = normalize(merged);
  await ensureDefaultsDirectory();
  const defaultsPath = getDefaultsPath(safe);
  const persistable: S3Defaults = {
    ...normalized,
    secretAccessKey: encryptSecretAccessKey(normalized.secretAccessKey),
  };
  await writeFile(defaultsPath, JSON.stringify(persistable, null, 2), {
    encoding: "utf8",
    mode: PRIVATE_FILE_MODE,
  });
  await chmod(defaultsPath, PRIVATE_FILE_MODE);
  cache.set(safe, normalized);
  return structuredClone(normalized);
}

async function ensureDefaultsDirectory(): Promise<void> {
  const dir = getDefaultsDir();
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await chmod(dir, PRIVATE_DIR_MODE);
}

export function toClientS3Defaults(d: S3Defaults): ClientS3Defaults {
  const { secretAccessKey, ...rest } = d;
  return { ...rest, hasSecretAccessKey: secretAccessKey.length > 0 };
}
