import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "x".repeat(64);
});

import {
  createTwoFactorChallengeToken,
  verifyTwoFactorChallengeToken,
} from "@/lib/auth/two-factor-challenge";

describe("two-factor challenge tokens", () => {
  it("round-trips through verify", () => {
    const token = createTwoFactorChallengeToken({ userId: "u1", email: "user@example.com" });
    const claims = verifyTwoFactorChallengeToken(token);
    expect(claims).not.toBeNull();
    expect(claims?.userId).toBe("u1");
    expect(claims?.kind).toBe("2fa_challenge");
    expect(claims?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a tampered payload", () => {
    const token = createTwoFactorChallengeToken({ userId: "u1", email: "user@example.com" });
    const [, sig] = token.split(".");
    const fake = `${Buffer.from('{"userId":"u2","email":"x","exp":9999999999,"kind":"2fa_challenge"}').toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.${sig}`;
    expect(verifyTwoFactorChallengeToken(fake)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyTwoFactorChallengeToken("")).toBeNull();
    expect(verifyTwoFactorChallengeToken(null)).toBeNull();
    expect(verifyTwoFactorChallengeToken("nopayload")).toBeNull();
    expect(verifyTwoFactorChallengeToken("a.b")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const original = Date.now;
    Date.now = () => 1_000_000_000_000;
    const token = createTwoFactorChallengeToken({ userId: "u1", email: "user@example.com" });
    Date.now = () => 1_000_000_000_000 + 6 * 60 * 1000;
    try {
      expect(verifyTwoFactorChallengeToken(token)).toBeNull();
    } finally {
      Date.now = original;
    }
  });
});
