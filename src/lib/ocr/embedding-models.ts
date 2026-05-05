const KNOWN_EMBEDDING_PATTERNS: RegExp[] = [
  /(^|[/-])embed/i,
  /-embedding(s)?[:/-]/i,
  /^all-minilm/i,
  /^bge-/i,
  /^e5-/i,
  /^gte-/i,
  /^snowflake-arctic-embed/i,
  /^paraphrase-/i,
  /^sentence-transformers\//i,
  /^text-embedding-/i,
  /^embed-/i,
  /\/embedding-/i,
];

export function isEmbeddingModelName(name: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  return KNOWN_EMBEDDING_PATTERNS.some((re) => re.test(trimmed));
}

export function filterChatModels(names: readonly string[]): string[] {
  return names.filter((name) => !isEmbeddingModelName(name));
}
