import { describe, it, expect } from "vitest";
import { extractFirstBalancedJsonObject, extractMarkdownFromJsonLikeText } from "@/lib/ocr/text-extract";

describe("extractFirstBalancedJsonObject", () => {
  it("extracts a simple object", () => {
    expect(extractFirstBalancedJsonObject('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it("ignores leading text", () => {
    expect(extractFirstBalancedJsonObject('here is {"key":"value"}')).toBe('{"key":"value"}');
  });

  it("handles nested objects", () => {
    expect(extractFirstBalancedJsonObject('{"a":{"b":1}}')).toBe('{"a":{"b":1}}');
  });

  it("stops at first balanced closing brace", () => {
    expect(extractFirstBalancedJsonObject('{"a":1}{"b":2}')).toBe('{"a":1}');
  });

  it("ignores braces inside strings", () => {
    expect(extractFirstBalancedJsonObject('{"key":"val{ue"}')).toBe('{"key":"val{ue"}');
  });

  it("handles escaped quotes in strings", () => {
    expect(extractFirstBalancedJsonObject('{"key":"say \\"hi\\""}')).toBe('{"key":"say \\"hi\\""}');
  });

  it("returns null when no object found", () => {
    expect(extractFirstBalancedJsonObject("no braces here")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractFirstBalancedJsonObject("")).toBeNull();
  });

  it("returns null for unclosed object", () => {
    expect(extractFirstBalancedJsonObject('{"unclosed":')).toBeNull();
  });
});

describe("extractMarkdownFromJsonLikeText", () => {
  it("extracts markdown field value", () => {
    const input = '{"markdown":"hello world"}';
    expect(extractMarkdownFromJsonLikeText(input)).toBe("hello world");
  });

  it("handles escaped newlines", () => {
    const input = '{"markdown":"line1\\nline2"}';
    expect(extractMarkdownFromJsonLikeText(input)).toBe("line1\nline2");
  });

  it("handles escaped \\r\\n sequences", () => {
    const input = '{"markdown":"line1\\r\\nline2"}';
    expect(extractMarkdownFromJsonLikeText(input)).toBe("line1\nline2");
  });

  it("strips leading ```json fence", () => {
    const input = '```json\n{"markdown":"hello"}';
    expect(extractMarkdownFromJsonLikeText(input)).toBe("hello");
  });

  it("strips leading ``` fence", () => {
    const input = '```\n{"markdown":"hello"}';
    expect(extractMarkdownFromJsonLikeText(input)).toBe("hello");
  });

  it("strips leading json prefix", () => {
    const input = 'json {"markdown":"hello"}';
    expect(extractMarkdownFromJsonLikeText(input)).toBe("hello");
  });

  it("returns null when no markdown key", () => {
    expect(extractMarkdownFromJsonLikeText('{"text":"foo"}')).toBeNull();
  });

  it("returns null when markdown value is not a quoted string", () => {
    expect(extractMarkdownFromJsonLikeText('{"markdown":null}')).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractMarkdownFromJsonLikeText("")).toBeNull();
  });

  it("handles multiple fields after markdown", () => {
    const input = '{"markdown":"content","other":"field"}';
    expect(extractMarkdownFromJsonLikeText(input)).toBe("content");
  });
});
