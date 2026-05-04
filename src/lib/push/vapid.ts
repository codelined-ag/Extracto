import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import webpush from "web-push";

interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
  subject: string;
}

let cached: VapidKeyPair | null = null;
let inflight: Promise<VapidKeyPair> | null = null;
let configured = false;

function getDataRoot(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url?.startsWith("file:")) return process.cwd();
  return path.dirname(url.replace(/^file:/u, ""));
}

function vapidPath(): string {
  return path.join(getDataRoot(), ".vapid_keys.json");
}

async function loadOrGenerate(): Promise<VapidKeyPair> {
  const file = vapidPath();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<VapidKeyPair>;
    if (parsed.publicKey && parsed.privateKey) {
      return {
        publicKey: parsed.publicKey,
        privateKey: parsed.privateKey,
        subject: parsed.subject || (process.env.VAPID_SUBJECT || "mailto:admin@extracto.local"),
      };
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[push] could not read vapid keys:", err);
    }
  }

  const env = {
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim(),
    privateKey: process.env.VAPID_PRIVATE_KEY?.trim(),
    subject: process.env.VAPID_SUBJECT?.trim(),
  };
  if (env.publicKey && env.privateKey) {
    return { publicKey: env.publicKey, privateKey: env.privateKey, subject: env.subject || "mailto:admin@extracto.local" };
  }

  const generated = webpush.generateVAPIDKeys();
  const pair: VapidKeyPair = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: env.subject || "mailto:admin@extracto.local",
  };
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(pair, null, 2), { encoding: "utf8", mode: 0o600 });
    await chmod(file, 0o600).catch(() => undefined);
  } catch (err) {
    console.warn("[push] could not persist vapid keys; will regenerate next start:", err);
  }
  return pair;
}

export async function getVapidKeys(): Promise<VapidKeyPair> {
  if (cached) return cached;
  if (!inflight) {
    inflight = loadOrGenerate().then((pair) => {
      cached = pair;
      if (!configured) {
        webpush.setVapidDetails(pair.subject, pair.publicKey, pair.privateKey);
        configured = true;
      }
      return pair;
    }).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

export async function getPublicVapidKey(): Promise<string> {
  return (await getVapidKeys()).publicKey;
}

export { webpush };
