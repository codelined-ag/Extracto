import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isKbExportEnabled } from "@/lib/kb/feature-flag";

const ORIGINAL = process.env.KB_EXPORT_ENABLED;

beforeEach(() => {
  delete process.env.KB_EXPORT_ENABLED;
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.KB_EXPORT_ENABLED;
  } else {
    process.env.KB_EXPORT_ENABLED = ORIGINAL;
  }
});

describe("isKbExportEnabled", () => {
  it("returns true when the env var is unset (default-on)", () => {
    expect(isKbExportEnabled()).toBe(true);
  });

  it("returns true when the env var is empty string (default-on)", () => {
    process.env.KB_EXPORT_ENABLED = "";
    expect(isKbExportEnabled()).toBe(true);
  });

  it("returns true for '1' / 'true' / 'TRUE'", () => {
    process.env.KB_EXPORT_ENABLED = "1";
    expect(isKbExportEnabled()).toBe(true);
    process.env.KB_EXPORT_ENABLED = "true";
    expect(isKbExportEnabled()).toBe(true);
    process.env.KB_EXPORT_ENABLED = "TRUE";
    expect(isKbExportEnabled()).toBe(true);
  });

  it("returns false for '0' / 'false' / anything else", () => {
    process.env.KB_EXPORT_ENABLED = "0";
    expect(isKbExportEnabled()).toBe(false);
    process.env.KB_EXPORT_ENABLED = "false";
    expect(isKbExportEnabled()).toBe(false);
    process.env.KB_EXPORT_ENABLED = "no";
    expect(isKbExportEnabled()).toBe(false);
  });
});
