import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSmtpStatus, isSmtpConfigured } from "@/lib/auth/smtp";

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_SECURE"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isSmtpConfigured", () => {
  it("is false when env is unset", () => {
    expect(isSmtpConfigured()).toBe(false);
  });

  it("is false when host is set but from is missing", () => {
    process.env.SMTP_HOST = "mail.example.com";
    process.env.SMTP_PORT = "587";
    expect(isSmtpConfigured()).toBe(false);
  });

  it("is false when port is non-numeric", () => {
    process.env.SMTP_HOST = "mail.example.com";
    process.env.SMTP_PORT = "smtp";
    process.env.SMTP_FROM = "noreply@example.com";
    expect(isSmtpConfigured()).toBe(false);
  });

  it("is true when host, port, and from are all set", () => {
    process.env.SMTP_HOST = "mail.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_FROM = "noreply@example.com";
    expect(isSmtpConfigured()).toBe(true);
  });
});

describe("getSmtpStatus", () => {
  it("reflects unconfigured state", () => {
    expect(getSmtpStatus()).toEqual({ configured: false, fromAddress: null, host: null });
  });

  it("returns configuration summary when SMTP env is set", () => {
    process.env.SMTP_HOST = "mail.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_FROM = "noreply@example.com";
    expect(getSmtpStatus()).toEqual({
      configured: true,
      fromAddress: "noreply@example.com",
      host: "mail.example.com",
    });
  });
});
