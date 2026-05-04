import { describe, it, expect } from "vitest";
import { normalizeAdvancedSettings, DEFAULT_SETTINGS } from "@/lib/ocr/settings";
import type { AdvancedSettings } from "@/lib/ocr/settings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a complete valid AdvancedSettings object. */
function validSettings(overrides: Partial<AdvancedSettings> = {}): AdvancedSettings {
  return {
    language: "en",
    tableDetection: true,
    handwritingRecognition: true,
    preserveFormatting: false,
    customPrompt: "Extract all text",
    quality: 90,
    preferTextLayer: true,
    documentPreset: "generic",
    pageConcurrency: 0,
    autoRetryMaxAttempts: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Valid full object
// ---------------------------------------------------------------------------

describe("normalizeAdvancedSettings — valid full object", () => {
  it("preserves all fields when given a complete valid object", () => {
    const input = validSettings();
    const result = normalizeAdvancedSettings(input);
    expect(result).toEqual(input);
  });

  it("preserves language when it is a non-empty string", () => {
    const result = normalizeAdvancedSettings(validSettings({ language: "fr" }));
    expect(result.language).toBe("fr");
  });

  it("preserves tableDetection: false (does not fall back to default)", () => {
    const result = normalizeAdvancedSettings(validSettings({ tableDetection: false }));
    expect(result.tableDetection).toBe(false);
  });

  it("preserves tableDetection: true", () => {
    const result = normalizeAdvancedSettings(validSettings({ tableDetection: true }));
    expect(result.tableDetection).toBe(true);
  });

  it("preserves handwritingRecognition: true", () => {
    const result = normalizeAdvancedSettings(validSettings({ handwritingRecognition: true }));
    expect(result.handwritingRecognition).toBe(true);
  });

  it("preserves handwritingRecognition: false", () => {
    const result = normalizeAdvancedSettings(validSettings({ handwritingRecognition: false }));
    expect(result.handwritingRecognition).toBe(false);
  });

  it("preserves preserveFormatting: false", () => {
    const result = normalizeAdvancedSettings(validSettings({ preserveFormatting: false }));
    expect(result.preserveFormatting).toBe(false);
  });

  it("preserves a non-empty customPrompt string", () => {
    const result = normalizeAdvancedSettings(validSettings({ customPrompt: "Extract tables" }));
    expect(result.customPrompt).toBe("Extract tables");
  });
});

// ---------------------------------------------------------------------------
// Empty object → defaults
// ---------------------------------------------------------------------------

describe("normalizeAdvancedSettings — empty object", () => {
  it("returns all default values for an empty object input", () => {
    const result = normalizeAdvancedSettings({});
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("returns language: 'auto' (the default) for an empty object", () => {
    expect(normalizeAdvancedSettings({}).language).toBe("auto");
  });

  it("returns tableDetection: true (the default) for an empty object", () => {
    expect(normalizeAdvancedSettings({}).tableDetection).toBe(true);
  });

  it("returns handwritingRecognition: false (the default) for an empty object", () => {
    expect(normalizeAdvancedSettings({}).handwritingRecognition).toBe(false);
  });

  it("returns preserveFormatting: true (the default) for an empty object", () => {
    expect(normalizeAdvancedSettings({}).preserveFormatting).toBe(true);
  });

  it("returns customPrompt: '' (the default) for an empty object", () => {
    expect(normalizeAdvancedSettings({}).customPrompt).toBe("");
  });

  it("returns quality: 80 (the default) for an empty object", () => {
    expect(normalizeAdvancedSettings({}).quality).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// null / non-object inputs → defaults
// ---------------------------------------------------------------------------

describe("normalizeAdvancedSettings — null and non-object inputs", () => {
  it("returns all defaults for null", () => {
    expect(normalizeAdvancedSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns all defaults for undefined", () => {
    expect(normalizeAdvancedSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns all defaults for a number", () => {
    expect(normalizeAdvancedSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns all defaults for a string", () => {
    expect(normalizeAdvancedSettings("settings")).toEqual(DEFAULT_SETTINGS);
  });

  it("returns all defaults for an array", () => {
    expect(normalizeAdvancedSettings(["language", "en"])).toEqual(DEFAULT_SETTINGS);
  });

  it("returns all defaults for a boolean", () => {
    expect(normalizeAdvancedSettings(true)).toEqual(DEFAULT_SETTINGS);
  });
});

// ---------------------------------------------------------------------------
// quality clamping and rounding
// ---------------------------------------------------------------------------

describe("normalizeAdvancedSettings — quality rounding and clamping", () => {
  function q(value: number): number {
    return normalizeAdvancedSettings(validSettings({ quality: value })).quality;
  }

  it("rounds 75 to 80 (nearest 10, .5 rounds up)", () => {
    expect(q(75)).toBe(80);
  });

  it("rounds 55 to 60", () => {
    expect(q(55)).toBe(60);
  });

  it("keeps 50 as 50 (at lower boundary)", () => {
    expect(q(50)).toBe(50);
  });

  it("keeps 100 as 100 (at upper boundary)", () => {
    expect(q(100)).toBe(100);
  });

  it("rounds 74 down to 70", () => {
    expect(q(74)).toBe(70);
  });

  it("rounds 76 up to 80", () => {
    expect(q(76)).toBe(80);
  });

  it("rounds 65 to 70 (nearest 10, .5 rounds up)", () => {
    expect(q(65)).toBe(70);
  });

  it("clamps 0 up to 50 (minimum)", () => {
    expect(q(0)).toBe(50);
  });

  it("clamps negative values up to 50", () => {
    expect(q(-10)).toBe(50);
  });

  it("clamps 110 down to 100 (maximum)", () => {
    expect(q(110)).toBe(100);
  });

  it("clamps 200 down to 100", () => {
    expect(q(200)).toBe(100);
  });

  it("uses the default (80) when quality is not a number", () => {
    const result = normalizeAdvancedSettings({ quality: "high" as unknown as number });
    expect(result.quality).toBe(80);
  });

  it("uses the default when quality is NaN", () => {
    const result = normalizeAdvancedSettings({ quality: NaN });
    expect(result.quality).toBe(80);
  });

  it("uses the default when quality is Infinity", () => {
    const result = normalizeAdvancedSettings({ quality: Infinity });
    expect(result.quality).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Invalid boolean fields → defaults
// ---------------------------------------------------------------------------

describe("normalizeAdvancedSettings — invalid boolean fields fall back to defaults", () => {
  it("uses default tableDetection when given a string 'true'", () => {
    const result = normalizeAdvancedSettings({ tableDetection: "true" as unknown as boolean });
    expect(result.tableDetection).toBe(DEFAULT_SETTINGS.tableDetection);
  });

  it("uses default tableDetection when given a number 1", () => {
    const result = normalizeAdvancedSettings({ tableDetection: 1 as unknown as boolean });
    expect(result.tableDetection).toBe(DEFAULT_SETTINGS.tableDetection);
  });

  it("uses default handwritingRecognition when given null", () => {
    const result = normalizeAdvancedSettings({
      handwritingRecognition: null as unknown as boolean,
    });
    expect(result.handwritingRecognition).toBe(DEFAULT_SETTINGS.handwritingRecognition);
  });

  it("uses default preserveFormatting when given undefined", () => {
    const result = normalizeAdvancedSettings({
      preserveFormatting: undefined as unknown as boolean,
    });
    expect(result.preserveFormatting).toBe(DEFAULT_SETTINGS.preserveFormatting);
  });
});

// ---------------------------------------------------------------------------
// String field — language
// ---------------------------------------------------------------------------

describe("normalizeAdvancedSettings — language field", () => {
  it("uses default language when given an empty string", () => {
    // The implementation checks `candidate?.language && typeof ...` — empty string is falsy.
    const result = normalizeAdvancedSettings({ language: "" });
    expect(result.language).toBe(DEFAULT_SETTINGS.language);
  });

  it("uses default language when given a number", () => {
    const result = normalizeAdvancedSettings({ language: 42 as unknown as string });
    expect(result.language).toBe(DEFAULT_SETTINGS.language);
  });

  it("preserves 'auto' as a valid language string", () => {
    const result = normalizeAdvancedSettings({ language: "auto" });
    expect(result.language).toBe("auto");
  });

  it("preserves an arbitrary non-empty language code", () => {
    const result = normalizeAdvancedSettings({ language: "zh-TW" });
    expect(result.language).toBe("zh-TW");
  });
});

// ---------------------------------------------------------------------------
// customPrompt field
// ---------------------------------------------------------------------------

describe("normalizeAdvancedSettings — customPrompt field", () => {
  it("uses default (empty string) when customPrompt is an empty string", () => {
    // Empty string is falsy so the implementation falls back to default.
    const result = normalizeAdvancedSettings({ customPrompt: "" });
    expect(result.customPrompt).toBe(DEFAULT_SETTINGS.customPrompt);
  });

  it("uses default when customPrompt is a number", () => {
    const result = normalizeAdvancedSettings({ customPrompt: 123 as unknown as string });
    expect(result.customPrompt).toBe(DEFAULT_SETTINGS.customPrompt);
  });

  it("preserves a non-empty customPrompt string", () => {
    const result = normalizeAdvancedSettings({ customPrompt: "List all headings" });
    expect(result.customPrompt).toBe("List all headings");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS export
// ---------------------------------------------------------------------------

describe("DEFAULT_SETTINGS", () => {
  it("has the expected shape and values", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      language: "auto",
      tableDetection: true,
      handwritingRecognition: false,
      preserveFormatting: true,
      customPrompt: "",
      quality: 80,
      preferTextLayer: true,
      documentPreset: "generic",
      pageConcurrency: 0,
      autoRetryMaxAttempts: 1,
    });
  });
});
