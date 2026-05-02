import { describe, it, expect } from "vitest";
import {
  appendPageMarkdown,
  coerceMarkdownText,
  extractStructuredPageEntryMarkdown,
  getPageMarkdownForRouting,
  parseJsonCandidate,
} from "@/lib/ocr/markdown-routing";

describe("parseJsonCandidate", () => {
  it("returns null for empty input", () => {
    expect(parseJsonCandidate("")).toBe(null);
    expect(parseJsonCandidate("   ")).toBe(null);
  });

  it("parses a plain JSON object", () => {
    expect(parseJsonCandidate('{"foo":"bar"}')).toEqual({ foo: "bar" });
  });

  it("parses a JSON object inside fenced code block", () => {
    expect(parseJsonCandidate('```json\n{"foo":"bar"}\n```')).toEqual({ foo: "bar" });
    expect(parseJsonCandidate('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips leading 'json ' label", () => {
    expect(parseJsonCandidate('json {"x":1}')).toEqual({ x: 1 });
  });

  it("strips surrounding quotes (returns the string the JSON literal contained)", () => {
    // Input is a JSON-encoded string literal; parsing returns the inner string.
    // The surrounding-quote-strip fallback isn't reached because the first parse succeeds.
    expect(parseJsonCandidate('"{\\"y\\":2}"')).toBe('{"y":2}');
  });

  it("falls back to balanced-bracket extraction for embedded JSON", () => {
    expect(parseJsonCandidate('Here is data: {"k":"v"} and more text')).toEqual({ k: "v" });
  });

  it("returns null for non-JSON garbage", () => {
    expect(parseJsonCandidate("just plain text with no json")).toBe(null);
  });

  it("parses arrays", () => {
    expect(parseJsonCandidate("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("returns null when balanced brackets fail to parse", () => {
    expect(parseJsonCandidate("{not valid json}")).toBe(null);
  });
});

describe("coerceMarkdownText", () => {
  it("returns trimmed string when input is plain markdown", () => {
    expect(coerceMarkdownText("  # Header  ", "")).toBe("# Header");
  });

  it("returns fallback when input is not a string", () => {
    expect(coerceMarkdownText(42, "fallback")).toBe("fallback");
    expect(coerceMarkdownText(null, "fallback")).toBe("fallback");
    expect(coerceMarkdownText(undefined, "fallback")).toBe("fallback");
    expect(coerceMarkdownText({ md: "x" }, "fallback")).toBe("fallback");
  });

  it("returns fallback when input is empty/whitespace", () => {
    expect(coerceMarkdownText("", "fb")).toBe("fb");
    expect(coerceMarkdownText("   ", "fb")).toBe("fb");
  });

  it("trims the fallback string", () => {
    expect(coerceMarkdownText(undefined, "  fb  ")).toBe("fb");
  });

  it("extracts nested markdown from JSON", () => {
    expect(coerceMarkdownText('{"markdown":"# Hello"}', "")).toBe("# Hello");
  });

  it("extracts nested text from JSON", () => {
    expect(coerceMarkdownText('{"text":"plain text"}', "")).toBe("plain text");
  });

  it("extracts nested content from JSON", () => {
    expect(coerceMarkdownText('{"content":"the content"}', "")).toBe("the content");
  });

  it("prefers markdown over text/content", () => {
    expect(coerceMarkdownText('{"markdown":"md","text":"tx"}', "")).toBe("md");
  });

  it("returns trimmed text when JSON has none of markdown/text/content", () => {
    expect(coerceMarkdownText('{"other":"value"}', "")).toBe('{"other":"value"}');
  });

  it("returns the trimmed input when JSON parses to a non-object and has no markdown key", () => {
    // parseJsonCandidate returns 'just a string' (a string), but the typeof !== 'object'
    // branch falls through. extractMarkdownFromJsonLikeText needs a "markdown" key, so
    // it returns null. Final fallback: return trimmed input verbatim (with quotes).
    expect(coerceMarkdownText('"just a string"', "")).toBe('"just a string"');
  });
});

describe("extractStructuredPageEntryMarkdown", () => {
  it("returns empty string when structured.pages is missing", () => {
    expect(extractStructuredPageEntryMarkdown({}, 1)).toBe("");
  });

  it("returns empty string when structured.pages is empty", () => {
    expect(extractStructuredPageEntryMarkdown({ pages: [] }, 1)).toBe("");
  });

  it("matches by index field (1-indexed)", () => {
    const structured = { pages: [{ index: 1, markdown: "page one md" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 1)).toBe("page one md");
  });

  it("matches by index field (0-indexed)", () => {
    const structured = { pages: [{ index: 0, markdown: "page one md" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 1)).toBe("page one md");
  });

  it("matches by pageNumber field", () => {
    const structured = { pages: [{ pageNumber: 2, markdown: "page two" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 2)).toBe("page two");
  });

  it("matches by page field", () => {
    const structured = { pages: [{ page: 3, markdown: "page three" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 3)).toBe("page three");
  });

  it("falls back through markdown -> text -> content -> html", () => {
    expect(extractStructuredPageEntryMarkdown({ pages: [{ index: 1, text: "txt" }] }, 1)).toBe("txt");
    expect(extractStructuredPageEntryMarkdown({ pages: [{ index: 1, html: "<p>html</p>" }] }, 1)).toBe("<p>html</p>");
  });

  it("skips entries with non-matching index", () => {
    const structured = { pages: [{ index: 5, markdown: "wrong page" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 1)).toBe("");
  });

  it("includes entries with no index field", () => {
    const structured = { pages: [{ markdown: "no-index entry" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 1)).toBe("no-index entry");
  });

  it("joins multiple matching entries with double newline", () => {
    const structured = {
      pages: [
        { index: 1, markdown: "first" },
        { markdown: "second" },
      ],
    };
    expect(extractStructuredPageEntryMarkdown(structured, 1)).toBe("first\n\nsecond");
  });

  it("ignores non-object pages entries (string, null, array)", () => {
    const structured = { pages: ["string", null, [1, 2], { index: 1, markdown: "real" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 1)).toBe("real");
  });

  it("rounds non-integer index values via Math.floor", () => {
    const structured = { pages: [{ index: 1.7, markdown: "rounds to 1" }] };
    expect(extractStructuredPageEntryMarkdown(structured, 1)).toBe("rounds to 1");
  });
});

describe("getPageMarkdownForRouting", () => {
  it("uses structured.markdown as the primary source", () => {
    const page = { pageNumber: 1, text: "raw", structured: { markdown: "the md" } };
    expect(getPageMarkdownForRouting(page)).toBe("the md");
  });

  it("falls back to structured.text", () => {
    const page = { pageNumber: 1, text: "raw", structured: { text: "from text" } };
    expect(getPageMarkdownForRouting(page)).toBe("from text");
  });

  it("falls back to structured.content", () => {
    const page = { pageNumber: 1, text: "raw", structured: { content: "from content" } };
    expect(getPageMarkdownForRouting(page)).toBe("from content");
  });

  it("falls back to structured.extractedText", () => {
    const page = { pageNumber: 1, text: "raw", structured: { extractedText: "from extracted" } };
    expect(getPageMarkdownForRouting(page)).toBe("from extracted");
  });

  it("falls back to structured.pages[].markdown matching by pageNumber", () => {
    const page = {
      pageNumber: 2,
      text: "raw fallback",
      structured: { pages: [{ pageNumber: 2, markdown: "from pages array" }] },
    };
    expect(getPageMarkdownForRouting(page)).toBe("from pages array");
  });

  it("falls back to page.text trimmed when nothing else matches", () => {
    const page = { pageNumber: 1, text: "  raw text  ", structured: {} };
    expect(getPageMarkdownForRouting(page)).toBe("raw text");
  });

  it("returns empty string when everything is empty", () => {
    const page = { pageNumber: 1, text: "", structured: {} };
    expect(getPageMarkdownForRouting(page)).toBe("");
  });
});

describe("appendPageMarkdown", () => {
  const makePage = (text: string, structured: Record<string, unknown> = {}) => ({
    pageNumber: 1,
    text,
    structured,
  });

  it("returns unchanged state for empty page", () => {
    expect(appendPageMarkdown("existing", 5, makePage(""))).toEqual({ text: "existing", chunks: 5 });
  });

  it("returns unchanged state for whitespace-only page", () => {
    expect(appendPageMarkdown("existing", 5, makePage("   "))).toEqual({ text: "existing", chunks: 5 });
  });

  it("appends markdown without separator on first chunk", () => {
    expect(appendPageMarkdown("", 0, makePage("first"))).toEqual({ text: "first", chunks: 1 });
  });

  it("appends with separator on subsequent chunks", () => {
    expect(appendPageMarkdown("first", 1, makePage("second"))).toEqual({
      text: "first\n\n---\n\n" + "second",
      chunks: 2,
    });
  });

  it("uses getPageMarkdownForRouting (structured.markdown wins)", () => {
    const page = { pageNumber: 1, text: "raw", structured: { markdown: "structured md" } };
    expect(appendPageMarkdown("", 0, page)).toEqual({ text: "structured md", chunks: 1 });
  });

  it("trims the returned markdown before appending", () => {
    expect(appendPageMarkdown("", 0, makePage("  trimmed  "))).toEqual({ text: "trimmed", chunks: 1 });
  });

  it("preserves chunks count when page is empty", () => {
    const result = appendPageMarkdown("text", 7, makePage(""));
    expect(result.chunks).toBe(7);
  });

  it("can be chained over multiple pages", () => {
    let state: { text: string; chunks: number } = { text: "", chunks: 0 };
    state = appendPageMarkdown(state.text, state.chunks, makePage("a"));
    state = appendPageMarkdown(state.text, state.chunks, makePage(""));
    state = appendPageMarkdown(state.text, state.chunks, makePage("b"));
    expect(state).toEqual({ text: "a\n\n---\n\nb", chunks: 2 });
  });
});
