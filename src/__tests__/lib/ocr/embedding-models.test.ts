import { describe, expect, it } from "vitest";

import { filterChatModels, isEmbeddingModelName } from "@/lib/ocr/embedding-models";

describe("isEmbeddingModelName", () => {
  it("matches the popular Ollama embedding tags", () => {
    expect(isEmbeddingModelName("nomic-embed-text:latest")).toBe(true);
    expect(isEmbeddingModelName("mxbai-embed-large")).toBe(true);
    expect(isEmbeddingModelName("snowflake-arctic-embed:latest")).toBe(true);
    expect(isEmbeddingModelName("all-minilm:l6-v2")).toBe(true);
    expect(isEmbeddingModelName("bge-large-en-v1.5")).toBe(true);
    expect(isEmbeddingModelName("e5-large-v2")).toBe(true);
  });

  it("matches OpenAI and OpenRouter embedding endpoints", () => {
    expect(isEmbeddingModelName("text-embedding-3-small")).toBe(true);
    expect(isEmbeddingModelName("text-embedding-3-large")).toBe(true);
    expect(isEmbeddingModelName("text-embedding-ada-002")).toBe(true);
    expect(isEmbeddingModelName("voyage-3-embedding")).toBe(true);
    expect(isEmbeddingModelName("cohere/embed-multilingual-v3.0")).toBe(true);
    expect(isEmbeddingModelName("openai/text-embedding-3-large")).toBe(true);
  });

  it("does not flag chat models that mention embed in unrelated places", () => {
    expect(isEmbeddingModelName("llama3.1:8b")).toBe(false);
    expect(isEmbeddingModelName("gpt-4o")).toBe(false);
    expect(isEmbeddingModelName("gpt-4o-mini")).toBe(false);
    expect(isEmbeddingModelName("anthropic/claude-3.5-sonnet")).toBe(false);
    expect(isEmbeddingModelName("mistral-large-latest")).toBe(false);
    expect(isEmbeddingModelName("qwen2.5vl:7b")).toBe(false);
    expect(isEmbeddingModelName("gemma3:12b")).toBe(false);
  });

  it("returns false for empty or whitespace input", () => {
    expect(isEmbeddingModelName("")).toBe(false);
    expect(isEmbeddingModelName("   ")).toBe(false);
  });
});

describe("filterChatModels", () => {
  it("removes embedding tags but keeps chat tags in their original order", () => {
    const input = [
      "qwen2.5vl:7b",
      "nomic-embed-text:latest",
      "llama3.1:8b",
      "mxbai-embed-large",
      "gemma3:12b",
    ];
    expect(filterChatModels(input)).toEqual(["qwen2.5vl:7b", "llama3.1:8b", "gemma3:12b"]);
  });

  it("returns an empty array when given an empty list", () => {
    expect(filterChatModels([])).toEqual([]);
  });
});
