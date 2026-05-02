import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  verifyWebhookSignature,
  generateWebhookSecret,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from "@/lib/webhooks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a valid `t=<ts>,v1=<sig>` header string using the same algorithm as
 * the implementation's private `signPayload` function.
 */
function buildSignatureHeader(secret: string, body: string, timestamp: number): string {
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

const NOW_SECONDS = Math.floor(Date.now() / 1000);
const SECRET = "test-webhook-secret-for-unit-tests";
const BODY = JSON.stringify({ event: "job.completed", job: { id: "abc123" } });

// ---------------------------------------------------------------------------
// verifyWebhookSignature — happy path
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature — valid signature", () => {
  it("returns true for a valid signature at the current timestamp", () => {
    const header = buildSignatureHeader(SECRET, BODY, NOW_SECONDS);
    const result = verifyWebhookSignature(SECRET, BODY, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(true);
  });

  it("returns true for a valid signature at the start of the tolerance window", () => {
    const timestamp = NOW_SECONDS - WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
    const header = buildSignatureHeader(SECRET, BODY, timestamp);
    const result = verifyWebhookSignature(SECRET, BODY, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(true);
  });

  it("returns true for a valid signature at the end of the tolerance window (future)", () => {
    const timestamp = NOW_SECONDS + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
    const header = buildSignatureHeader(SECRET, BODY, timestamp);
    const result = verifyWebhookSignature(SECRET, BODY, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(true);
  });

  it("returns true with a custom shorter toleranceSeconds option", () => {
    const timestamp = NOW_SECONDS - 30;
    const header = buildSignatureHeader(SECRET, BODY, timestamp);
    const result = verifyWebhookSignature(SECRET, BODY, header, {
      nowSeconds: NOW_SECONDS,
      toleranceSeconds: 60,
    });
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — timestamp outside tolerance
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature — expired timestamp", () => {
  it("returns false when timestamp is one second past the tolerance window (past)", () => {
    const timestamp = NOW_SECONDS - WEBHOOK_SIGNATURE_TOLERANCE_SECONDS - 1;
    const header = buildSignatureHeader(SECRET, BODY, timestamp);
    const result = verifyWebhookSignature(SECRET, BODY, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(false);
  });

  it("returns false when timestamp is one second past the tolerance window (future)", () => {
    const timestamp = NOW_SECONDS + WEBHOOK_SIGNATURE_TOLERANCE_SECONDS + 1;
    const header = buildSignatureHeader(SECRET, BODY, timestamp);
    const result = verifyWebhookSignature(SECRET, BODY, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(false);
  });

  it("returns false with a very old timestamp", () => {
    const timestamp = NOW_SECONDS - 86_400; // 24 hours ago
    const header = buildSignatureHeader(SECRET, BODY, timestamp);
    const result = verifyWebhookSignature(SECRET, BODY, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — wrong secret
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature — wrong secret", () => {
  it("returns false when a different secret is used to verify", () => {
    const header = buildSignatureHeader("correct-secret", BODY, NOW_SECONDS);
    const result = verifyWebhookSignature("wrong-secret", BODY, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — tampered body
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature — tampered body", () => {
  it("returns false when the body differs from what was signed", () => {
    const header = buildSignatureHeader(SECRET, BODY, NOW_SECONDS);
    const tamperedBody = JSON.stringify({ event: "job.failed", job: { id: "abc123" } });
    const result = verifyWebhookSignature(SECRET, tamperedBody, header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(false);
  });

  it("returns false when an extra character is appended to the body", () => {
    const header = buildSignatureHeader(SECRET, BODY, NOW_SECONDS);
    const result = verifyWebhookSignature(SECRET, BODY + " ", header, {
      nowSeconds: NOW_SECONDS,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature — malformed / missing header
// ---------------------------------------------------------------------------

describe("verifyWebhookSignature — malformed or missing header", () => {
  it("returns false for null header", () => {
    expect(verifyWebhookSignature(SECRET, BODY, null, { nowSeconds: NOW_SECONDS })).toBe(false);
  });

  it("returns false for undefined header", () => {
    expect(verifyWebhookSignature(SECRET, BODY, undefined, { nowSeconds: NOW_SECONDS })).toBe(
      false
    );
  });

  it("returns false for empty string header", () => {
    expect(verifyWebhookSignature(SECRET, BODY, "", { nowSeconds: NOW_SECONDS })).toBe(false);
  });

  it("returns false when the header is missing the timestamp part", () => {
    const sig = createHmac("sha256", SECRET)
      .update(`${NOW_SECONDS}.${BODY}`, "utf8")
      .digest("hex");
    const header = `v1=${sig}`;
    expect(verifyWebhookSignature(SECRET, BODY, header, { nowSeconds: NOW_SECONDS })).toBe(false);
  });

  it("returns false when the header is missing the v1 signature part", () => {
    const header = `t=${NOW_SECONDS}`;
    expect(verifyWebhookSignature(SECRET, BODY, header, { nowSeconds: NOW_SECONDS })).toBe(false);
  });

  it("returns false for an arbitrary non-parseable string", () => {
    expect(
      verifyWebhookSignature(SECRET, BODY, "not-a-valid-header", { nowSeconds: NOW_SECONDS })
    ).toBe(false);
  });

  it("returns false when timestamp is not a number (NaN)", () => {
    const sig = createHmac("sha256", SECRET)
      .update(`notanumber.${BODY}`, "utf8")
      .digest("hex");
    const header = `t=notanumber,v1=${sig}`;
    expect(verifyWebhookSignature(SECRET, BODY, header, { nowSeconds: NOW_SECONDS })).toBe(false);
  });

  it("returns false when the v1 value is empty", () => {
    const header = `t=${NOW_SECONDS},v1=`;
    expect(verifyWebhookSignature(SECRET, BODY, header, { nowSeconds: NOW_SECONDS })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateWebhookSecret
// ---------------------------------------------------------------------------

describe("generateWebhookSecret", () => {
  it('returns a string starting with "whsec_"', () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith("whsec_")).toBe(true);
  });

  it("has at least 32 hex characters after the prefix", () => {
    const secret = generateWebhookSecret();
    const hexPart = secret.slice("whsec_".length);
    expect(hexPart.length).toBeGreaterThanOrEqual(32);
    // All characters after prefix must be valid hex
    expect(hexPart).toMatch(/^[0-9a-f]+$/);
  });

  it("generates a different secret on each call", () => {
    const s1 = generateWebhookSecret();
    const s2 = generateWebhookSecret();
    expect(s1).not.toBe(s2);
  });

  it("uses 32 random bytes (64 hex chars) after the prefix", () => {
    // randomBytes(32).toString("hex") always produces 64 hex chars
    const secret = generateWebhookSecret();
    const hexPart = secret.slice("whsec_".length);
    expect(hexPart).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// WEBHOOK_SIGNATURE_TOLERANCE_SECONDS export
// ---------------------------------------------------------------------------

describe("WEBHOOK_SIGNATURE_TOLERANCE_SECONDS", () => {
  it("equals 300 (5 minutes)", () => {
    expect(WEBHOOK_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });
});
