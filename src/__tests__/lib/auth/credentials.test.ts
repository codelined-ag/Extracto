import { scryptSync, randomBytes } from "node:crypto";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
  },
}));

import { normalizeEmail, verifyPassword } from "@/lib/auth/credentials";

describe("normalizeEmail", () => {
  it("lowercases the email", () => {
    expect(normalizeEmail("User@Example.COM")).toBe("user@example.com");
  });

  it("trims whitespace", () => {
    expect(normalizeEmail("  user@example.com  ")).toBe("user@example.com");
  });

  it("handles already-normalized email", () => {
    expect(normalizeEmail("user@example.com")).toBe("user@example.com");
  });

  it("handles empty string", () => {
    expect(normalizeEmail("")).toBe("");
  });
});

describe("verifyPassword", () => {
  it("verifies a correct password against its hash", () => {
    // We need to create a real hash first. Since hashPassword is private,
    // we test through the full round-trip via the scrypt format.
    // Create a hash manually using the same format: salt:hash
    const salt = randomBytes(16).toString("hex");
    const key = scryptSync("secret", salt, 64).toString("hex");
    const hash = `${salt}:${key}`;
    expect(verifyPassword("secret", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const salt = randomBytes(16).toString("hex");
    const key = scryptSync("secret", salt, 64).toString("hex");
    const hash = `${salt}:${key}`;
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("returns false for malformed hash (no colon)", () => {
    expect(verifyPassword("password", "badsaltandhash")).toBe(false);
  });

  it("returns false for empty hash", () => {
    expect(verifyPassword("password", "")).toBe(false);
  });

  it("rejects when hash lengths differ", () => {
    const salt = randomBytes(16).toString("hex");
    const shortKey = scryptSync("other", salt, 32).toString("hex");
    const hash = `${salt}:${shortKey}`;
    expect(verifyPassword("password", hash)).toBe(false);
  });
});
