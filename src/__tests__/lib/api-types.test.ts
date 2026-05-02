import { describe, it, expect } from "vitest";
import { normalizeProvider, type ProviderKind } from "@/lib/api-types";

describe("normalizeProvider", () => {
  it("returns ollama for undefined input", () => {
    expect(normalizeProvider(undefined)).toBe("ollama");
  });

  it("returns ollama for empty string", () => {
    expect(normalizeProvider("")).toBe("ollama");
  });

  it("returns ollama for whitespace", () => {
    expect(normalizeProvider("   ")).toBe("ollama");
  });

  it("returns mistral for 'mistral'", () => {
    expect(normalizeProvider("mistral")).toBe("mistral");
  });

  it("returns mistral for 'MISTRAL' (case-insensitive)", () => {
    expect(normalizeProvider("MISTRAL")).toBe("mistral");
  });

  it("returns mistral for 'mistral:something' (strips colon suffix)", () => {
    expect(normalizeProvider("mistral:large-latest")).toBe("mistral");
  });

  it("returns openrouter for 'openrouter'", () => {
    expect(normalizeProvider("openrouter")).toBe("openrouter");
  });

  it("returns openrouter for 'OpenRouter'", () => {
    expect(normalizeProvider("OpenRouter")).toBe("openrouter");
  });

  it("returns openai_compat for 'openai_compat'", () => {
    expect(normalizeProvider("openai_compat")).toBe("openai_compat");
  });

  it("returns ollama for unknown provider", () => {
    expect(normalizeProvider("anthropic")).toBe("ollama");
  });

  it("returns ollama for 'openai' (not the same as openai_compat)", () => {
    expect(normalizeProvider("openai")).toBe("ollama");
  });

  it("trims whitespace before matching", () => {
    expect(normalizeProvider("  mistral  ")).toBe("mistral");
  });

  it("output is assignable to ProviderKind", () => {
    const result: ProviderKind = normalizeProvider("mistral");
    expect(result).toBe("mistral");
  });
});
