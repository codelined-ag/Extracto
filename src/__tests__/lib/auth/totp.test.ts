import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "x".repeat(64);
});

import {
  generateTotpEnrollment,
  hashRecoveryCodes,
  readRecoveryRecords,
  verifyTotpCode,
} from "@/lib/auth/totp";
import { generate } from "otplib";

describe("verifyTotpCode", () => {
  it("returns false for empty inputs", () => {
    expect(verifyTotpCode("", "")).toBe(false);
    expect(verifyTotpCode("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "")).toBe(false);
    expect(verifyTotpCode("", "123456")).toBe(false);
  });

  it("returns false for non-6-digit tokens", () => {
    expect(verifyTotpCode("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "abc")).toBe(false);
    expect(verifyTotpCode("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "12345")).toBe(false);
    expect(verifyTotpCode("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "1234567")).toBe(false);
  });

  it("strips whitespace before checking", () => {
    expect(verifyTotpCode("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "12 34 56")).toBe(false);
  });

  it("accepts a freshly generated TOTP for the same secret", async () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const token = await generate({ strategy: "totp", secret });
    expect(verifyTotpCode(secret, token)).toBe(true);
  });
});

describe("generateTotpEnrollment", () => {
  it("returns secret, otpauthUrl, qr data url, and 10 recovery codes", async () => {
    const enrollment = await generateTotpEnrollment({ email: "user@example.com" });
    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrollment.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.qrPngDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(enrollment.recoveryCodes).toHaveLength(10);
    for (const code of enrollment.recoveryCodes) {
      expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });
});

describe("hashRecoveryCodes / readRecoveryRecords", () => {
  it("round-trips records through readRecoveryRecords", () => {
    const codes = ["AAAA-BBBB-CCCC", "1111-2222-3333"];
    const records = hashRecoveryCodes(codes);
    expect(records).toHaveLength(2);
    for (const r of records) {
      expect(r.hash).toMatch(/^[0-9a-f]+$/);
      expect(r.salt).toMatch(/^[0-9a-f]+$/);
    }
    const round = readRecoveryRecords(records);
    expect(round).toHaveLength(2);
    expect(round[0].hash).toBe(records[0].hash);
  });

  it("ignores malformed entries", () => {
    expect(readRecoveryRecords([null, "bad", { hash: "x" }, { hash: "x", salt: "y" }])).toEqual([
      { hash: "x", salt: "y", used: false },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(readRecoveryRecords(null)).toEqual([]);
    expect(readRecoveryRecords({})).toEqual([]);
    expect(readRecoveryRecords("string")).toEqual([]);
  });
});
