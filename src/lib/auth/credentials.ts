import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { db } from "@/lib/db";

interface AuthUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  passwordChangedAt: Date;
  name: string | null;
  totpEnabled?: boolean;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const key = scryptSync(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) return false;

  const derived = hashPassword(password, salt).split(":")[1];
  const hashBuffer = Buffer.from(storedHash, "hex");
  const derivedBuffer = Buffer.from(derived, "hex");

  if (hashBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(hashBuffer, derivedBuffer);
}

const DUMMY_SALT = "0".repeat(32);
const DUMMY_HASH = scryptSync("dummy-password-for-timing", DUMMY_SALT, 64).toString("hex");

export function runDummyPasswordVerify(password: string): void {
  scryptSync(password, DUMMY_SALT, 64);
  void DUMMY_HASH;
}

export async function findUserByEmail(email: string): Promise<AuthUserRecord | null> {
  const normalizedEmail = normalizeEmail(email);
  return await db.authUser.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      passwordChangedAt: true,
      name: true,
      totpEnabled: true,
    },
  });
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthUserRecord> {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedName = normalizeName(input.name || "");

  const passwordHash = hashPassword(input.password);

  return await db.authUser.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: normalizedName,
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      passwordChangedAt: true,
      name: true,
    },
  });
}

export async function findUserById(userId: string): Promise<AuthUserRecord | null> {
  return await db.authUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      passwordChangedAt: true,
      name: true,
    },
  });
}

export async function updateUserPassword(userId: string, newPassword: string): Promise<Date> {
  const passwordHash = hashPassword(newPassword);
  const passwordChangedAt = new Date();
  await db.authUser.update({
    where: { id: userId },
    data: { passwordHash, passwordChangedAt },
  });
  return passwordChangedAt;
}

export function toSafeUser(user: AuthUserRecord): { id: string; email: string; name: string | null } {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

