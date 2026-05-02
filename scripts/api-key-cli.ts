#!/usr/bin/env bun
import { PrismaClient } from "@prisma/client";
import { ALL_SCOPES, WILDCARD_SCOPE } from "@/lib/auth/scopes";
import { generateApiKey } from "@/lib/auth/api-key";

function usage(code = 0): never {
  console.log(`Usage:
  api-key-cli create <user-email> <key-name> [--scopes=a,b,c] [--rate-limit=N]
                                              Create a new API key.
                                              Scopes default to "*". Available:
                                                ocr:submit, ocr:read, ocr:control,
                                                settings:read, settings:write,
                                                webhooks:read, webhooks:write,
                                                presets:read, presets:write,
                                                search:read, *
  api-key-cli list <user-email>                List API keys for a user
  api-key-cli revoke <key-id>                  Revoke an API key by id

Environment:
  AUTH_SECRET   Required. Used to hash API keys.
  DATABASE_URL  Required. Path to the SQLite database (e.g. file:/app/data/custom.db).`);
  process.exit(code);
}

const VALID_SCOPES = new Set<string>([...ALL_SCOPES, WILDCARD_SCOPE]);

function parseFlags(args: string[]): { scopes: string[] | null; rateLimit: number | null; positional: string[] } {
  const positional: string[] = [];
  let scopes: string[] | null = null;
  let rateLimit: number | null = null;
  for (const arg of args) {
    if (arg.startsWith("--scopes=")) {
      const list = arg.slice("--scopes=".length).split(",").map((s) => s.trim()).filter(Boolean);
      const invalid = list.filter((s) => !VALID_SCOPES.has(s));
      if (invalid.length > 0) {
        console.error(`ERROR: invalid scope(s): ${invalid.join(", ")}`);
        process.exit(1);
      }
      scopes = list.includes(WILDCARD_SCOPE) ? [WILDCARD_SCOPE] : list;
    } else if (arg.startsWith("--rate-limit=")) {
      const n = Number(arg.slice("--rate-limit=".length));
      if (!Number.isFinite(n) || n < 1 || n > 600) {
        console.error("ERROR: --rate-limit must be 1..600");
        process.exit(1);
      }
      rateLimit = Math.trunc(n);
    } else {
      positional.push(arg);
    }
  }
  return { scopes, rateLimit, positional };
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

async function cmdCreate(
  prisma: PrismaClient,
  email: string,
  name: string,
  scopes: string[] | null,
  rateLimit: number | null
) {
  const user = await findUserByEmail(prisma, email);
  const trimmedName = name.trim();
  if (!trimmedName) {
    console.error("ERROR: key name is required");
    process.exit(1);
  }

  const effectiveScopes = scopes && scopes.length > 0 ? scopes : [WILDCARD_SCOPE];
  const { plaintext, prefix, keyHash } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: trimmedName,
      prefix,
      keyHash,
      scopes: JSON.stringify(effectiveScopes),
      rateLimitPerMinute: rateLimit,
    },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });

  console.log("API key created. Store it now — it will not be shown again.");
  console.log(`  id:        ${created.id}`);
  console.log(`  user:      ${user.email}`);
  console.log(`  name:      ${created.name}`);
  console.log(`  prefix:    ${created.prefix}`);
  console.log(`  scopes:    ${effectiveScopes.join(",")}`);
  console.log(`  rateLimit: ${rateLimit ?? "default (global)"}`);
  console.log(`  createdAt: ${created.createdAt.toISOString()}`);
  console.log("");
  console.log(`  key:       ${plaintext}`);
}

async function cmdList(prisma: PrismaClient, email: string) {
  const user = await findUserByEmail(prisma, email);
  const keys = await prisma.apiKey.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      rateLimitPerMinute: true,
      totalRequests: true,
      requestsThisMonth: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  if (keys.length === 0) {
    console.log(`No API keys for ${user.email}`);
    return;
  }
  for (const key of keys) {
    const status = key.revokedAt ? "revoked" : "active";
    const lastUsed = key.lastUsedAt ? key.lastUsedAt.toISOString() : "never";
    let scopeList = "*";
    try {
      const parsed = JSON.parse(key.scopes);
      if (Array.isArray(parsed)) scopeList = parsed.join(",");
    } catch {
      // ignore
    }
    console.log(
      `${key.id}  ${key.prefix}…  ${status}  name="${key.name}"  scopes=${scopeList}  ` +
        `rateLimit=${key.rateLimitPerMinute ?? "default"}  ` +
        `requests=${key.totalRequests}/${key.requestsThisMonth}  ` +
        `lastUsed=${lastUsed}  createdAt=${key.createdAt.toISOString()}`
    );
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
        const flags = parseFlags(rest);
        const [email, ...nameParts] = flags.positional;
        if (!email || nameParts.length === 0) usage(1);
        await cmdCreate(prisma, email, nameParts.join(" "), flags.scopes, flags.rateLimit);
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
