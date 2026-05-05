import { describe, expect, it } from "vitest";

import { redactPii } from "@/lib/pii/redact";

describe("redactPii", () => {
  it("redacts an email address with a count suffix", () => {
    const r = redactPii("contact me at alice@example.com please");
    expect(r.redactedText).toContain("[REDACTED:EMAIL:1]");
    expect(r.redactedText).not.toContain("alice@example.com");
    expect(r.countsByKind.email).toBe(1);
  });

  it("numbers redactions sequentially per kind", () => {
    const r = redactPii("a@b.com and c@d.com");
    expect(r.redactedText).toContain("[REDACTED:EMAIL:1]");
    expect(r.redactedText).toContain("[REDACTED:EMAIL:2]");
    expect(r.countsByKind.email).toBe(2);
  });

  it("redacts an SSN", () => {
    const r = redactPii("SSN 123-45-6789");
    expect(r.redactedText).toContain("[REDACTED:SSN:1]");
    expect(r.redactedText).not.toContain("123-45-6789");
  });

  it("rejects an SSN with a forbidden area number (000, 666, 9xx)", () => {
    const r = redactPii("000-00-0000 666-12-3456 900-12-3456");
    expect(r.countsByKind.ssn).toBe(0);
  });

  it("redacts a Luhn-valid credit card", () => {
    const r = redactPii("Card 4111 1111 1111 1111 expires");
    expect(r.redactedText).toContain("[REDACTED:CREDIT_CARD:1]");
  });

  it("does not redact a Luhn-invalid 16-digit number", () => {
    const r = redactPii("Order 1234 5678 9012 3456");
    expect(r.countsByKind.credit_card).toBe(0);
  });

  it("redacts a URL", () => {
    const r = redactPii("see https://internal.example/secret-page for details");
    expect(r.redactedText).toContain("[REDACTED:URL:1]");
    expect(r.redactedText).not.toContain("https://internal");
  });

  it("redacts an IBAN-shaped string", () => {
    const r = redactPii("IBAN GB29NWBK60161331926819 here");
    expect(r.redactedText).toContain("[REDACTED:IBAN:1]");
  });

  it("redacts an IPv4 address", () => {
    const r = redactPii("server at 192.168.1.50 down");
    expect(r.redactedText).toContain("[REDACTED:IP:1]");
  });

  it("redacts a date of birth", () => {
    const r = redactPii("DOB 03/14/1985 enrolled");
    expect(r.redactedText).toContain("[REDACTED:DATE_OF_BIRTH:1]");
  });

  it("preserves non-PII surrounding text exactly", () => {
    const r = redactPii("Hello alice@example.com, welcome.");
    expect(r.redactedText).toMatch(/^Hello \[REDACTED:EMAIL:1\], welcome\.$/);
  });

  it("returns char offsets that bound the original PII span", () => {
    const text = "ping me at hello@world.com today";
    const r = redactPii(text);
    expect(r.matches).toHaveLength(1);
    const match = r.matches[0];
    expect(text.slice(match.startOffset, match.endOffset)).toBe("hello@world.com");
  });

  it("handles overlapping patterns by merging into the longer match", () => {
    const r = redactPii("hello https://foo.example/path?email=a@b.com bye");
    expect(r.matches).toHaveLength(1);
    expect(r.redactedText).toContain("[REDACTED:URL:1]");
    expect(r.redactedText).not.toContain("[REDACTED:EMAIL");
  });

  it("returns an empty redaction when there is no PII", () => {
    const text = "no pii here just words";
    const r = redactPii(text);
    expect(r.redactedText).toBe(text);
    expect(r.matches).toEqual([]);
    expect(r.countsByKind.email).toBe(0);
  });
});
