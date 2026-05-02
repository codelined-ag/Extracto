import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  compareKeyHashes,
} from "@/lib/auth/api-key";

const TEST_SECRET = "test-secret-that-is-at-least-32-chars-long";

describe("api-key (with AUTH_SECRET set)", () => {
  let originalSecret: string | undefined;

  beforeAll(() => {
    originalSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalSecret;
    }
  });

  describe("generateApiKey()", () => {
    it("produces a plaintext that starts with the API_KEY_PREFIX", () => {
      const { plaintext } = generateApiKey();
      expect(plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    });

    it("produces a prefix whose length equals API_KEY_PREFIX.length + 6", () => {
      const { prefix } = generateApiKey();
      expect(prefix.length).toBe(API_KEY_PREFIX.length + 6);
    });

    it("prefix is the first (API_KEY_PREFIX.length + 6) characters of plaintext", () => {
      const { plaintext, prefix } = generateApiKey();
      expect(prefix).toBe(plaintext.slice(0, API_KEY_PREFIX.length + 6));
    });

    it("keyHash is a hex string", () => {
      const { keyHash } = generateApiKey();
      expect(keyHash).toMatch(/^[0-9a-f]+$/);
    });

    it("keyHash has the expected SHA-256 hex length (64 chars)", () => {
      const { keyHash } = generateApiKey();
      expect(keyHash).toHaveLength(64);
    });

    it("produces different plaintexts on successive calls (randomness check)", () => {
      const first = generateApiKey();
      const second = generateApiKey();
      expect(first.plaintext).not.toBe(second.plaintext);
    });

    it("produces different keyHashes on successive calls", () => {
      const first = generateApiKey();
      const second = generateApiKey();
      expect(first.keyHash).not.toBe(second.keyHash);
    });
  });

  describe("hashApiKey()", () => {
    it("returns the same hash for the same input", () => {
      const input = "extr_some_key_value";
      expect(hashApiKey(input)).toBe(hashApiKey(input));
    });

    it("returns different hashes for different inputs", () => {
      expect(hashApiKey("extr_key_one")).not.toBe(hashApiKey("extr_key_two"));
    });

    it("returns a hex string of length 64", () => {
      const hash = hashApiKey("any_input");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("hash matches the keyHash produced by generateApiKey for the same plaintext", () => {
      const { plaintext, keyHash } = generateApiKey();
      expect(hashApiKey(plaintext)).toBe(keyHash);
    });
  });

  describe("compareKeyHashes()", () => {
    it("returns true when comparing a hash to itself", () => {
      const hash = hashApiKey("extr_same_key");
      expect(compareKeyHashes(hash, hash)).toBe(true);
    });

    it("returns true for two independently computed hashes of the same input", () => {
      const a = hashApiKey("extr_match");
      const b = hashApiKey("extr_match");
      expect(compareKeyHashes(a, b)).toBe(true);
    });

    it("returns false for hashes of different inputs", () => {
      const a = hashApiKey("extr_key_a");
      const b = hashApiKey("extr_key_b");
      expect(compareKeyHashes(a, b)).toBe(false);
    });

    it("returns false when lengths differ (mismatched-length hex)", () => {
      const full = hashApiKey("extr_some_key");
      const partial = full.slice(0, 32); // half-length, still valid hex
      expect(compareKeyHashes(full, partial)).toBe(false);
    });

    it("returns false for empty strings (zero-length buffers)", () => {
      expect(compareKeyHashes("", "")).toBe(false);
    });

    it("returns false when one side is empty", () => {
      const hash = hashApiKey("extr_some_key");
      expect(compareKeyHashes(hash, "")).toBe(false);
      expect(compareKeyHashes("", hash)).toBe(false);
    });
  });
});

describe("api-key (AUTH_SECRET not set)", () => {
  let originalSecret: string | undefined;

  beforeAll(() => {
    originalSecret = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
  });

  afterAll(() => {
    if (originalSecret !== undefined) {
      process.env.AUTH_SECRET = originalSecret;
    }
  });

  it("hashApiKey throws when AUTH_SECRET is not set", () => {
    expect(() => hashApiKey("any_key")).toThrow("AUTH_SECRET is required");
  });

  it("generateApiKey throws when AUTH_SECRET is not set", () => {
    expect(() => generateApiKey()).toThrow("AUTH_SECRET is required");
  });
});
