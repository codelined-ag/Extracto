#!/usr/bin/env bun
import { createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const KEY_PREFIX = "extr_";
const RAW_KEY_BYTES = 32;
const PREFIX_DISPLAY_LENGTH = 6;

function getAuthSecret(): string {
  const configured = process.env.AUTH_SECRET?.trim();
  if (!configured) {
    console.error("ERROR: AUTH_SECRET is required");
    process.exit(1);
  }
  if (configured.length < 32) {
    console.error("ERROR: AUTH_SECRET must be at least 32 characters");
    process.exit(1);
  }
  return configured;
}

function base64UrlEncode(bytes: Buffer): string {
  return bytes.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function hashApiKey(plaintext: string): string {
  return createHmac("sha256", getAuthSecret()).update(plaintext, "utf8").digest("hex");
}

function generateApiKey() {
  const random = randomBytes(RAW_KEY_BYTES);
  const plaintext = `${KEY_PREFIX}${base64UrlEncode(random)}`;
  const prefix = plaintext.slice(0, KEY_PREFIX.length + PREFIX_DISPLAY_LENGTH);
  return { plaintext, prefix, keyHash: hashApiKey(plaintext) };
}

function usage(code = 0): never {
  console.log(`Usage:
  api-key-cli create <user-email> <key-name>   Create a new API key for a user
  api-key-cli list <user-email>                List API keys for a user
  api-key-cli revoke <key-id>                  Revoke an API key by id

Environment:
  AUTH_SECRET   Required. Used to hash API keys.
  DATABASE_URL  Required. Path to the SQLite database (e.g. file:/app/data/custom.db).`);
  process.exit(code);
}

async function findUserByEmail(prisma: PrismaClient, email: string) {
  const user = await prisma.authUser.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`ERROR: no user found with email "${email}"`);
    process.exit(1);
  }
  return user;
}

async function cmdCreate(prisma: PrismaClient, email: string, name: string) {
  const user = await findUserByEmail(prisma, email);
  const trimmedName = name.trim();
  if (!trimmedName) {
    console.error("ERROR: key name is required");
    process.exit(1);
  }

  const { plaintext, prefix, keyHash } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: { userId: user.id, name: trimmedName, prefix, keyHash },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });

  console.log("API key created. Store it now — it will not be shown again.");
  console.log(`  id:        ${created.id}`);
  console.log(`  user:      ${user.email}`);
  console.log(`  name:      ${created.name}`);
  console.log(`  prefix:    ${created.prefix}`);
  console.log(`  createdAt: ${created.createdAt.toISOString()}`);
  console.log("");
  console.log(`  key:       ${plaintext}`);
}

async function cmdList(prisma: PrismaClient, email: string) {
  const user = await findUserByEmail(prisma, email);
  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  });
  if (keys.length === 0) {
    console.log(`No API keys for ${user.email}`);
    return;
  }
  for (const key of keys) {
    const status = key.revokedAt ? "revoked" : "active";
    const lastUsed = key.lastUsedAt ? key.lastUsedAt.toISOString() : "never";
    console.log(`${key.id}  ${key.prefix}…  ${status}  name="${key.name}"  lastUsed=${lastUsed}  createdAt=${key.createdAt.toISOString()}`);
  }
}

async function cmdRevoke(prisma: PrismaClient, keyId: string) {
  const updated = await prisma.apiKey.updateMany({
    where: { id: keyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (updated.count === 0) {
    console.error(`ERROR: no active key with id "${keyId}"`);
    process.exit(1);
  }
  console.log(`Revoked key ${keyId}`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (!subcommand || subcommand === "-h" || subcommand === "--help") {
    usage();
  }

  const prisma = new PrismaClient();
  try {
    switch (subcommand) {
      case "create": {
        const [email, ...nameParts] = rest;
        if (!email || nameParts.length === 0) usage(1);
        await cmdCreate(prisma, email, nameParts.join(" "));
        break;
      }
      case "list": {
        const [email] = rest;
        if (!email) usage(1);
        await cmdList(prisma, email);
        break;
      }
      case "revoke": {
        const [keyId] = rest;
        if (!keyId) usage(1);
        await cmdRevoke(prisma, keyId);
        break;
      }
      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        usage(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
