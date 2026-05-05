import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptIntegrationTokens,
  encryptIntegrationTokens,
} from "@/lib/integrations/crypto";

const FIXTURE_SECRET = "0".repeat(64);

describe("integration token crypto", () => {
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = FIXTURE_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
  });

  it("round-trips utf-8 plaintext", () => {
    const plaintext = JSON.stringify({ accessToken: "x".repeat(64), refreshToken: "y" });
    const ct = encryptIntegrationTokens(plaintext);
    expect(ct).not.toContain("accessToken");
    expect(decryptIntegrationTokens(ct)).toBe(plaintext);
  });

  it("produces a different ciphertext on each call (random IV)", () => {
    const a = encryptIntegrationTokens("hello");
    const b = encryptIntegrationTokens("hello");
    expect(a).not.toBe(b);
    expect(decryptIntegrationTokens(a)).toBe("hello");
    expect(decryptIntegrationTokens(b)).toBe("hello");
  });

  it("rejects a corrupted ciphertext", () => {
    const ct = encryptIntegrationTokens("payload");
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptIntegrationTokens(tampered)).toThrow();
  });

  it("rejects ciphertext encrypted under a different secret", () => {
    const ct = encryptIntegrationTokens("secret");
    process.env.AUTH_SECRET = "1".repeat(64);
    expect(() => decryptIntegrationTokens(ct)).toThrow();
  });

  it("requires AUTH_SECRET to be present", () => {
    delete process.env.AUTH_SECRET;
    expect(() => encryptIntegrationTokens("x")).toThrow(/AUTH_SECRET is required/);
  });
});
